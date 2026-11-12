// One live session: the browser's mic audio in, Deepgram's words out. The server only relays: the coaching
// rules run in the browser (packages/shared/src/engine.js), next to the pitch analysis.
//
// `client` is a `ws` WebSocket (on('message'|'close'), send, close). The upstream is a browser-style WebSocket
// (onopen/onmessage/onclose, send, close), Node's built-in one in production, a fake in tests.

import { CLOSE_STREAM, KEEP_ALIVE, listenUrl, openDeepgram, toClient, usageLine } from './deepgram.js';
import { LANGUAGES } from '@vocco/shared/protocol';

const OPEN = 1;
const MAX_BUFFERED_BYTES = 16000 * 2 * 5; // audio kept while Deepgram connects: 5 s
const LANG_IDS = new Set(LANGUAGES.map((l) => l.id));

/**
 * @param {any} client
 * @param {{ ip: string, config: ReturnType<import('./config.js').loadConfig>, guard: ReturnType<import('./guard.js').createGuard>,
 *           open?: (url: string) => any, log?: (line: string) => void, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout }} ctx
 */
export function handleSession(client, ctx) {
  const { ip, config, guard } = ctx;
  const open = ctx.open || ((url) => openDeepgram({ key: config.deepgramKey, url }));
  const log = ctx.log || ((l) => console.log(l));
  const setTimer = ctx.setTimer || setTimeout;
  const clearTimer = ctx.clearTimer || clearTimeout;

  let state = 'waiting'; // waiting → connecting → live → closing → done
  let upstream = null;
  let slot = false;
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
    if (slot) guard.closeSession(ip);
    slot = false;
    if (final) send(final);
    send({ type: 'closed', seconds: seconds() });
    try { upstream?.close(); } catch {}
    try { client.close(1000); } catch {}
    if (config.logUsage && bytes) log(usageLine({ model: config.deepgramModel, language, seconds: seconds() }));
  }

  function fail(message) {
    finish({ type: 'error', message });
  }

  function start(msg) {
    if (!config.deepgramKey) return fail('Listening isn’t set up on this server yet (no speech-to-text key).');
    if (!guard.openSession(ip)) return finish({ type: 'limit', reason: 'sessions', message: 'You already have a session open. Close it first, then try again.' });
    slot = true;
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
    if (msg?.type === 'start' && state === 'waiting') return start(msg);
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

  return { state: () => state, seconds };
}
