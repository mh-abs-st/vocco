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

// ----- sign-in (#9): a second app with accounts on, Supabase faked -----
test('with accounts on: config, me, report needs sign-in, delete account', async () => {
  const deleted = [];
  const db = {
    enabled: true,
    getUser: async (t) => (t === 'good' ? { id: 'u1', email: 'a@example.com' } : null),
    getAccount: async () => ({ user_id: 'u1', credits: 12 }),
    deleteUser: async (id) => deleted.push(id),
    hasLedgerRef: async () => false,
    spendCredits: async () => 10,
  };
  const config = loadConfig({ ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_s', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_p' });
  const srv = createServer(createApp(config, { guard: createGuard(config), db, fetchImpl: claude, log: () => {}, webRoot: '' }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const auth = { authorization: 'Bearer good' };
  try {
    const cfg = await (await realFetch(`${b}/api/config`)).json();
    assert.deepEqual(cfg, { accounts: true, supabaseUrl: 'https://x.supabase.co', publishableKey: 'sb_publishable_p', pricing: { livePerMinute: 1, report: 2, freeCredits: 10 } });
    assert.ok(!JSON.stringify(cfg).includes('sb_secret')); // the secret key never leaves the server

    assert.equal((await realFetch(`${b}/api/me`)).status, 401);
    assert.deepEqual(await (await realFetch(`${b}/api/me`, { headers: auth })).json(), { email: 'a@example.com', credits: 12 });

    const body = JSON.stringify({ transcript: 'Hi.', summary: { wpm: 140 }, sessionId: 's1' });
    const noAuth = await realFetch(`${b}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    assert.equal(noAuth.status, 401);
    assert.match((await noAuth.json()).error, /Sign in/);
    const badAuth = await realFetch(`${b}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bad' }, body });
    assert.equal(badAuth.status, 401);
    const ok = await realFetch(`${b}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body });
    assert.equal(ok.status, 200);

    assert.equal((await realFetch(`${b}/api/account`, { method: 'DELETE' })).status, 401);
    const del = await realFetch(`${b}/api/account`, { method: 'DELETE', headers: auth });
    assert.deepEqual(await del.json(), { deleted: true });
    assert.deepEqual(deleted, ['u1']);
    assert.equal((await (await realFetch(`${b}/health`)).json()).accounts, true);
  } finally {
    srv.close();
  }
});

test('without accounts: config says so, and me/account aren’t there', async () => {
  const r = await (await realFetch(`${base}/api/config`)).json();
  assert.deepEqual(r, { accounts: false });
  assert.equal((await realFetch(`${base}/api/me`)).status, 404);
});

// ----- credits (#10) -----
async function withAccountsApp(dbOverrides, fn) {
  const ledger = new Map(); // ref → delta
  let credits = dbOverrides.credits ?? 12;
  const calls = { claude: 0 };
  const db = {
    enabled: true,
    getUser: async (t) => (t === 'good' ? { id: 'u1', email: 'a@example.com' } : null),
    getAccount: async () => ({ user_id: 'u1', credits }),
    hasLedgerRef: async (ref) => ledger.has(ref),
    spendCredits: async (_u, amount, _r, { floor, ref }) => {
      if (credits - amount < floor) return null;
      credits -= amount;
      ledger.set(ref, (ledger.get(ref) || 0) - amount);
      return credits;
    },
  };
  const claudeFails = dbOverrides.claudeFails;
  const fetchImpl = async (...a) => {
    calls.claude++;
    if (claudeFails) return new Response('{"error":{"message":"overloaded"}}', { status: 529 });
    return claude(...a);
  };
  const config = loadConfig({ ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_s' });
  const srv = createServer(createApp(config, { guard: createGuard(config), db, fetchImpl, log: () => {}, webRoot: '' }));
  await new Promise((r) => srv.listen(0, r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const report = (sessionId) =>
    realFetch(`${b}/api/report`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer good' }, body: JSON.stringify({ transcript: 'Hi.', summary: {}, sessionId }) });
  try {
    await fn({ report, ledger, calls, credits: () => credits });
  } finally {
    srv.close();
  }
}

test('report credits: charged once per session after it is written; asking again is free', async () => {
  await withAccountsApp({ credits: 5 }, async ({ report, ledger, credits }) => {
    const r1 = await report('s1');
    assert.equal(r1.status, 200);
    assert.equal((await r1.json()).credits, 3);
    assert.equal(ledger.get('report:u1:s1'), -2);
    const r2 = await report('s1'); // the same session again
    assert.equal(r2.status, 200);
    assert.equal(credits(), 3);
    assert.equal((await report('')).status, 400); // a session id is required
  });
});

test('report credits: not enough → 402 before asking Claude', async () => {
  await withAccountsApp({ credits: 1 }, async ({ report, calls, credits }) => {
    const r = await report('s2');
    assert.equal(r.status, 402);
    const j = await r.json();
    assert.equal(j.code, 'credits');
    assert.match(j.error, /need 2 credits/);
    assert.equal(calls.claude, 0);
    assert.equal(credits(), 1);
  });
});

test('report credits: nothing charged when the report fails', async () => {
  await withAccountsApp({ credits: 5, claudeFails: true }, async ({ report, ledger, credits }) => {
    assert.equal((await report('s3')).status, 502);
    assert.equal(credits(), 5);
    assert.equal(ledger.size, 0);
  });
});

test('/api/me: the first visit grants free credits once and says so', async () => {
  let credits = 0, status = null;
  const ledger = new Set();
  const db = {
    enabled: true,
    getUser: async (t) => (t === 'good' ? { id: 'u7', email: 'new@example.com' } : null),
    getAccount: async () => ({ user_id: 'u7', credits, trial_status: status }),
    hasLedgerRef: async (ref) => ledger.has(ref),
    countTrialClaims: async () => 0,
    addTrialClaims: async () => null,
    grantCredits: async (_u, amount, _r, ref) => { if (!ledger.has(ref)) { ledger.add(ref); credits += amount; } return credits; },
    updateAccount: async (_u, f) => { status = f.trial_status; },
  };
  const config = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_s', TRIAL_SECRET: 't' });
  const srv = createServer(createApp(config, { guard: createGuard(config), db, log: () => {}, webRoot: '' }));
  await new Promise((r) => srv.listen(0, r));
  const me = () => realFetch(`http://127.0.0.1:${srv.address().port}/api/me`, { headers: { authorization: 'Bearer good', 'x-vocco-browser': 'browser-000000000001' } }).then((r) => r.json());
  try {
    assert.deepEqual(await me(), { email: 'new@example.com', credits: 10, trial: { status: 'granted', justGranted: true } });
    assert.deepEqual(await me(), { email: 'new@example.com', credits: 10, trial: { status: 'granted' } });
    assert.equal(ledger.size, 1);
  } finally {
    srv.close();
  }
});
