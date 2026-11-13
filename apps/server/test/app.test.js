import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createGuard } from '../src/guard.js';
import { loadConfig } from '../src/config.js';

let server, base, web;
const realFetch = globalThis.fetch;
const claude = async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'speech_report', input: { headline: 'Nice.', scores: {}, strengths: [], fixes: [], stronger: {}, drills: [] } }] }), { status: 200 });

before(async () => {
  web = await mkdtemp(join(tmpdir(), 'vocco-web-'));
  await mkdir(join(web, 'assets'));
  await writeFile(join(web, 'index.html'), '<!doctype html><title>Vocco</title>');
  await writeFile(join(web, 'assets', 'app-abc.js'), 'console.log(1)');
  const config = loadConfig({ ANTHROPIC_API_KEY: 'k', ALLOWED_ORIGINS: 'https://vocco.app', REPORTS_PER_HOUR_PER_IP: '2' });
  server = createServer(createApp(config, { guard: createGuard(config), fetchImpl: claude, log: () => {}, webRoot: web }));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await rm(web, { recursive: true, force: true });
});

const post = (path, body, headers = {}) => realFetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health says what is set up', async () => {
  const r = await (await realFetch(`${base}/health`)).json();
  assert.deepEqual(r, { ok: true, listening: false, reports: true, accounts: false });
});

test('topics are listed', async () => {
  const r = await (await realFetch(`${base}/api/topics`)).json();
  assert.ok(r.topics.length >= 50);
  assert.ok(r.categories.some((c) => c.id === 'debate'));
});

test('report: works, checks input, refuses other sites, limits per hour', async () => {
  const ok = await post('/api/report', { transcript: 'Hello.', summary: { wpm: 140 } }, { origin: 'https://vocco.app' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://vocco.app');
  assert.equal((await ok.json()).report.headline, 'Nice.');
  assert.equal((await post('/api/report', { summary: {} })).status, 400);
  assert.equal((await post('/api/report', { transcript: 'x', summary: {} }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/report', { transcript: 'x', summary: {} })).status, 429); // third from this address this hour
});

test('the web app is served, with app routes falling back to index.html', async () => {
  const home = await realFetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Vocco/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const asset = await realFetch(`${base}/assets/app-abc.js`);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  const route = await realFetch(`${base}/session/123`);
  assert.match(await route.text(), /Vocco/);
  const traversal = await realFetch(`${base}/..%2f..%2fetc%2fpasswd`);
  assert.doesNotMatch(await traversal.text(), /root:/);
  assert.equal((await realFetch(`${base}/api/nope`)).status, 404);
});
