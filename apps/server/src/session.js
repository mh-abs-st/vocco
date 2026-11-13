// One live session: the browser's mic audio in, Deepgram's words out. The server only relays: the coaching
// rules run in the browser (packages/shared/src/engine.js), next to the pitch analysis.
//
// `client` is a `ws` WebSocket (on('message'|'close'), send, close). The upstream is a browser-style WebSocket
// (onopen/onmessage/onclose, send, close), Node's built-in one in production, a fake in tests.

import { CLOSE_STREAM, KEEP_ALIVE, listenUrl, openDeepgram, toClient } from './deepgram.js';
import { sttCost } from './costs.js';
import { LANGUAGES } from '@vocco/shared/protocol';
import { randomUUID } from 'node:crypto';

const OPEN = 1;
const MAX_BUFFERED_BYTES = 16000 * 2 * 5; // audio kept while Deepgram connects: 5 s
const LANG_IDS = new Set(LANGUAGES.map((l) => l.id));

/**
 * @param {any} client
 * @param {{ ip: string, config: ReturnType<import('./config.js').loadConfig>, guard: ReturnType<import('./guard.js').createGuard>,
 *           auth?: (token: string) => Promise<{ id: string, email: string } | null>,
 *           credits?: ReturnType<import('./credits.js').createCredits>,
 *           costs?: ReturnType<import('./costs.js').createCostRecorder>,
 *           open?: (url: string) => any, log?: (line: string) => void, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} ctx
 *   `auth`: when accounts are on, checks the sign-in token sent with 'start'; no auth = no sign-in needed.
 *   `credits`: when accounts are on, a session needs a minute's credits to start, and every started minute of
 *   audio is charged (one ledger line per session). Out of credits: a warning before the last minute, then it stops.
 */
export function handleSession(client, ctx) {
  const { ip, config, guard } = ctx;
  const open = ctx.open || ((url) => openDeepgram({ key: config.deepgramKey, url }));
  const log = ctx.log || ((l) => console.log(l));
  const setTimer = ctx.setTimer || setTimeout;
  const clearTimer = ctx.clearTimer || clearTimeout;

  let state = 'waiting'; // waiting → checking (sign-in) → connecting → live → closing → done
  let upstream = null;
  /** @type {string[]} guard keys we hold a session slot for (the address, and the user when signed in) */
  let slots = [];
  /** @type {{ id: string, email: string } | null} */
  let user = null;
  const sessionId = randomUUID();
  let minutesPaid = 0;
  let charging = false;
  let chargeFailedAt = 0;
  let chargeFailures = 0;
  let pending = [];
  let pendingBytes = 0;
  let bytes = 0;
  let sampleRate = 16000;
  let language = 'en';
  let limitTimer = null;
  let keepAlive = null;

  const send = (msg) => {
    try {
      if (client.readyState === undefined || client.readyState === OPEN) client.send(JSON.stringify(msg));
    } catch {}
  };
  const seconds = () => Math.round((bytes / 2 / sampleRate) * 10) / 10;

  function finish(final) {
    if (state === 'done') return;
    state = 'done';
    if (limitTimer) clearTimer(limitTimer);
    if (keepAlive) clearInterval(keepAlive);
    for (const k of slots) guard.closeSession(k);
    slots = [];
    if (final) send(final);
    send({ type: 'closed', seconds: seconds() });
    try { upstream?.close(); } catch {}
    try { client.close(1000); } catch {}
    if (bytes && upstream) {
      ctx.costs?.record({ user_id: user?.id ?? null, activity: 'session', provider: 'deepgram', model: config.deepgramModel, audio_seconds: seconds(), cost_usd: sttCost(config.deepgramModel, seconds()) });
    }
  }

  /** Charge every started minute of audio. Runs on each chunk; does nothing until a new minute starts. */
  async function payForMinutes() {
    const needed = Math.floor(seconds() / 60) + 1; // a started minute counts
    if (needed <= minutesPaid || charging || state === 'done') return;
    if (chargeFailures && Date.now() - chargeFailedAt < 5000) return; // the database had a problem: retry every 5 s
    charging = true;
    try {
      const balance = await ctx.credits.chargeMinute(user, sessionId);
      chargeFailures = 0;
      if (balance === null || balance === undefined) {
        return finish({ type: 'limit', reason: 'credits', message: 'You’re out of credits, so the session stopped. Your report is ready.' });
      }
      minutesPaid++;
      if (balance < ctx.credits.costs.livePerMinute) {
        send({ type: 'credits', credits: balance, last: true, message: 'This is your last minute: you’re out of credits after it.' });
      }
    } catch (err) {
      chargeFailures++;
      chargeFailedAt = Date.now();
      log(`[credits] charge failed for ${user.id}: ${err?.message}`);
      // Don't give away long sessions when the database is down: stop after ~30 s of failures.
      if (chargeFailures >= 6) fail('Couldn’t check your credits, so the session stopped. Your report is ready.');
    } finally {
      charging = false;
    }
  }

  function fail(message) {
    finish({ type: 'error', message });
  }

  async function start(msg) {
    if (!config.deepgramKey) return fail('Listening isn’t set up on this server yet (no speech-to-text key).');
    state = 'checking';
    if (ctx.auth) {
      try {
        user = msg.token ? await ctx.auth(String(msg.token)) : null;
      } catch {
        user = null;
      }
      if (state !== 'checking') return; // the browser left meanwhile
      if (!user) return finish({ type: 'error', reason: 'auth', message: 'Sign in again to start a session.' });
    }
    if (user && ctx.credits) {
      let balance = 0;
      try {
        balance = await ctx.credits.balance(user);
      } catch {
        if (state !== 'checking') return;
        return fail('Couldn’t check your credits. Try again in a moment.');
      }
      if (state !== 'checking') return;
      if (balance < ctx.credits.costs.livePerMinute) {
        return finish({ type: 'limit', reason: 'credits', message: 'You’re out of credits. Add credits to start a session.' });
      }
    }
    const keys = user ? [ip, `user:${user.id}`] : [ip];
    for (const k of keys) {
      if (!guard.openSession(k)) {
        return finish({ type: 'limit', reason: 'sessions', message: 'You already have a session open. Close it first, then try again.' });
      }
      slots.push(k);
    }
    sampleRate = [16000, 24000, 48000].includes(Number(msg.sampleRate)) ? Number(msg.sampleRate) : 16000;
    language = LANG_IDS.has(msg.language) ? msg.language : 'en';
    state = 'connecting';
    try {
      upstream = open(listenUrl({ model: config.deepgramModel, language, sampleRate }));
    } catch (err) {
      return fail('Couldn’t start listening. Try again in a moment.');
    }
    upstream.onopen = () => {
      if (state !== 'connecting') return;
      state = 'live';
      for (const chunk of pending) upstream.send(chunk);
      pending = [];
      pendingBytes = 0;
      send({ type: 'ready', maxMinutes: config.maxSessionMin });
      // Deepgram closes a stream after ~10 s without audio; a paused session keeps it open this way.
      keepAlive = setInterval(() => {
        try { if (upstream.readyState === OPEN) upstream.send(KEEP_ALIVE); } catch {}
      }, 5000);
      keepAlive.unref?.();
    };
    upstream.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      for (const out of toClient(data)) send(out);
    };
    upstream.onerror = () => {
      if (state === 'connecting') fail('Couldn’t start listening. Check your connection and try again.');
    };
    upstream.onclose = () => {
      if (state === 'connecting') return fail('Couldn’t start listening. Try again in a moment.');
      // Closed while we were still sending audio: Deepgram dropped us. Say so, so the browser can reconnect.
      if (state === 'live') return finish({ type: 'error', reason: 'upstream', message: 'Listening stopped. What you said so far is safe.' });
      finish(null);
    };
    limitTimer = setTimer(() => {
      finish({ type: 'limit', reason: 'time', message: `Sessions stop at ${config.maxSessionMin} minutes. Your report is ready.` });
    }, config.maxSessionMin * 60_000);
    limitTimer.unref?.();
  }

  client.on('message', (data, isBinary) => {
    if (state === 'done' || state === 'closing') return;
    if (isBinary) {
      if (state === 'waiting') return; // audio before "start" is ignored
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytes += chunk.length;
      if (user && ctx.credits) void payForMinutes();
      if (state === 'live') {
        try { upstream.send(chunk); } catch {}
      } else if (pendingBytes + chunk.length <= MAX_BUFFERED_BYTES) {
        pending.push(chunk);
        pendingBytes += chunk.length;
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg?.type === 'start' && state === 'waiting') return void start(msg);
    if (msg?.type === 'stop') {
      if (state === 'live') {
        state = 'closing';
        try { upstream.send(CLOSE_STREAM); } catch {}
        // Deepgram sends its last words, then closes; don't wait forever.
        const t = setTimer(() => finish(null), 4000);
        t.unref?.();
      } else finish(null);
    }
  });

  client.on('close', () => finish(null));
  client.on('error', () => finish(null));

  return { state: () => state, seconds, user: () => user, minutesPaid: () => minutesPaid, sessionId };
}
