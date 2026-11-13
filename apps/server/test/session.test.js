import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { handleSession } from '../src/session.js';
import { createGuard } from '../src/guard.js';
import { loadConfig } from '../src/config.js';
import { listenParams, toClient } from '../src/deepgram.js';

class FakeClient extends EventEmitter {
  readyState = 1;
  sent = [];
  closed = false;
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; this.readyState = 3; }
  types() { return this.sent.map((m) => m.type); }
}
class FakeUpstream {
  readyState = 0;
  sent = [];
  constructor(url) { this.url = url; }
  send(d) { this.sent.push(d); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  emit(msg) { this.onmessage?.({ data: JSON.stringify(msg) }); }
}

function setup(env = {}, extra = {}) {
  const config = loadConfig({ DEEPGRAM_API_KEY: 'dg', ...env });
  const guard = extra.guard || createGuard(config);
  const client = new FakeClient();
  const ups = [];
  const timers = [];
  const ctx = {
    ip: '1.2.3.4', config, guard, log: () => {},
    open: (url) => { const u = new FakeUpstream(url); ups.push(u); return u; },
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: () => {},
  };
  handleSession(client, ctx);
  return { client, ups, timers, guard };
}
const pcm = (n = 3200) => Buffer.alloc(n);

test('Deepgram stream asks for raw PCM, word timings, fillers and the training opt-out', () => {
  const p = listenParams({ language: 'en-GB', sampleRate: 16000 });
  for (const [k, v] of [['encoding', 'linear16'], ['sample_rate', '16000'], ['filler_words', 'true'], ['punctuate', 'true'], ['mip_opt_out', 'true'], ['language', 'en-GB']]) assert.equal(p.get(k), v, k);
});

test('Deepgram results become word messages', () => {
  const out = toClient({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Hello there.', words: [{ word: 'hello', punctuated_word: 'Hello', start: 0.1, end: 0.4, confidence: 0.99 }, { word: 'there', punctuated_word: 'there.', start: 0.45, end: 0.8, confidence: 0.97 }] }] } });
  assert.deepEqual(out, [{ type: 'words', final: true, text: 'Hello there.', words: [{ word: 'hello', text: 'Hello', start: 0.1, end: 0.4, confidence: 0.99 }, { word: 'there', text: 'there.', start: 0.45, end: 0.8, confidence: 0.97 }] }]);
  assert.deepEqual(toClient({ type: 'Results', channel: { alternatives: [{ transcript: '', words: [] }] } }), []);
  assert.deepEqual(toClient({ type: 'UtteranceEnd' }), [{ type: 'utterance_end' }]);
  assert.deepEqual(toClient({ type: 'SpeechStarted' }), []);
});

test('a session: start, audio buffered until connected, words relayed, stop flushes and closes', () => {
  const { client, ups, guard } = setup();
  client.emit('message', pcm(), true); // before start: ignored
  client.emit('message', JSON.stringify({ type: 'start', language: 'en', sampleRate: 16000 }), false);
  assert.equal(ups.length, 1);
  assert.match(ups[0].url, /sample_rate=16000/);
  client.emit('message', pcm(), true);
  client.emit('message', pcm(), true);
  assert.equal(ups[0].sent.length, 0);
  ups[0].open();
  assert.equal(ups[0].sent.length, 2); // the buffered audio
  assert.deepEqual(client.sent[0], { type: 'ready', maxMinutes: 10 });
  client.emit('message', pcm(), true);
  assert.equal(ups[0].sent.length, 3);
  ups[0].emit({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: 'Hi.', words: [{ word: 'hi', punctuated_word: 'Hi.', start: 0, end: 0.2, confidence: 0.9 }] }] } });
  assert.equal(client.sent.at(-1).type, 'words');
  assert.equal(guard.openSessions('1.2.3.4'), 1);
  client.emit('message', JSON.stringify({ type: 'stop' }), false);
  assert.equal(ups[0].sent.at(-1), JSON.stringify({ type: 'CloseStream' }));
  ups[0].onclose();
  assert.deepEqual(client.sent.at(-1), { type: 'closed', seconds: 0.3 }); // 3 × 3200 bytes of 16-bit audio at 16 kHz
  assert.equal(client.closed, true);
  assert.equal(guard.openSessions('1.2.3.4'), 0);
});

test('no speech-to-text key: a clear error', () => {
  const { client } = setup({ DEEPGRAM_API_KEY: '' });
  client.emit('message', JSON.stringify({ type: 'start' }), false);
  assert.equal(client.sent[0].type, 'error');
  assert.match(client.sent[0].message, /isn’t set up/);
  assert.equal(client.closed, true);
});

test('one address can’t open more than its sessions', () => {
  const config = loadConfig({ DEEPGRAM_API_KEY: 'dg', MAX_SOCKETS_PER_IP: '1' });
  const guard = createGuard(config);
  const a = setup({ MAX_SOCKETS_PER_IP: '1' }, { guard });
  a.client.emit('message', JSON.stringify({ type: 'start' }), false);
  const b = setup({ MAX_SOCKETS_PER_IP: '1' }, { guard });
  b.client.emit('message', JSON.stringify({ type: 'start' }), false);
  assert.deepEqual(b.client.types(), ['limit', 'closed']);
  a.client.emit('close');
  assert.equal(guard.openSessions('1.2.3.4'), 0);
});

test('the time limit ends the session with a message', () => {
  const { client, ups, timers } = setup({ MAX_SESSION_MIN: '2' });
  client.emit('message', JSON.stringify({ type: 'start' }), false);
  ups[0].open();
  const limit = timers.find((t) => t.ms === 2 * 60_000);
  assert.ok(limit);
  limit.fn();
  assert.equal(client.sent.at(-2).type, 'limit');
  assert.equal(client.sent.at(-1).type, 'closed');
});

test('Deepgram failing to connect is reported once', () => {
  const { client, ups } = setup();
  client.emit('message', JSON.stringify({ type: 'start' }), false);
  ups[0].onerror();
  ups[0].onclose();
  assert.deepEqual(client.types(), ['error', 'closed']);
});

test('Deepgram dropping mid-session is reported, so the browser can reconnect', () => {
  const { client, ups, guard } = setup();
  client.emit('message', JSON.stringify({ type: 'start' }), false);
  ups[0].open();
  client.emit('message', pcm(), true);
  ups[0].onclose();
  assert.deepEqual(client.types(), ['ready', 'error', 'closed']);
  assert.equal(client.sent[1].reason, 'upstream');
  assert.equal(guard.openSessions('1.2.3.4'), 0);
});

test('a normal stop is not reported as an error', () => {
  const { client, ups } = setup();
  client.emit('message', JSON.stringify({ type: 'start' }), false);
  ups[0].open();
  client.emit('message', JSON.stringify({ type: 'stop' }), false);
  ups[0].onclose();
  assert.deepEqual(client.types(), ['ready', 'closed']);
});

// ----- sign-in (#9) -----
const tick = () => new Promise((r) => setImmediate(r));
test('with accounts on, a session needs a valid sign-in token', async () => {
  const users = { good: { id: 'u1', email: 'a@example.com' } };
  const config = loadConfig({ DEEPGRAM_API_KEY: 'dg' });
  const guard = createGuard(config);
  const mk = () => {
    const client = new FakeClient();
    const ups = [];
    handleSession(client, { ip: '1.2.3.4', config, guard, log: () => {}, auth: async (t) => users[t] || null, open: (url) => { const u = new FakeUpstream(url); ups.push(u); return u; }, setTimer: () => ({}), clearTimer: () => {} });
    return { client, ups };
  };
  const none = mk();
  none.client.emit('message', JSON.stringify({ type: 'start' }), false);
  await tick();
  assert.deepEqual(none.client.types(), ['error', 'closed']);
  assert.equal(none.client.sent[0].reason, 'auth');
  assert.equal(none.ups.length, 0); // Deepgram never opened

  const bad = mk();
  bad.client.emit('message', JSON.stringify({ type: 'start', token: 'nope' }), false);
  await tick();
  assert.equal(bad.client.sent[0].reason, 'auth');

  const ok = mk();
  ok.client.emit('message', JSON.stringify({ type: 'start', token: 'good' }), false);
  await tick();
  assert.equal(ok.ups.length, 1);
  assert.equal(guard.openSessions('user:u1'), 1);
  assert.equal(guard.openSessions('1.2.3.4'), 1);
  ok.client.emit('close');
  assert.equal(guard.openSessions('user:u1'), 0);
  assert.equal(guard.openSessions('1.2.3.4'), 0);
});

test('one user can’t open more sessions than allowed, even from other addresses', async () => {
  const config = loadConfig({ DEEPGRAM_API_KEY: 'dg', MAX_SOCKETS_PER_IP: '1' });
  const guard = createGuard(config);
  const mk = (ip) => {
    const client = new FakeClient();
    handleSession(client, { ip, config, guard, log: () => {}, auth: async () => ({ id: 'u1', email: '' }), open: (url) => new FakeUpstream(url), setTimer: () => ({}), clearTimer: () => {} });
    client.emit('message', JSON.stringify({ type: 'start', token: 't' }), false);
    return client;
  };
  const a = mk('1.1.1.1');
  await tick();
  const b = mk('2.2.2.2');
  await tick();
  assert.equal(b.sent[0].type, 'limit');
  assert.equal(guard.openSessions('2.2.2.2'), 0); // the address slot it took was given back
  a.emit('close');
  assert.equal(guard.openSessions('user:u1'), 0);
});
