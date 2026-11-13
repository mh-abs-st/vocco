import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabase, serverHeaders, isSecretKey } from '../src/supabase.js';
import { loadConfig } from '../src/config.js';

/** A fake fetch that records calls and answers from a list of handlers. */
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    const call = { url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const [status, body] = await handler(call);
    return new Response(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  f.calls = calls;
  return f;
}
const URL_ = 'https://abc.supabase.co/';

test('server key headers: a secret key only on apikey, the legacy JWT also as Bearer', () => {
  assert.equal(isSecretKey('sb_secret_x'), true);
  assert.deepEqual(serverHeaders('sb_secret_x'), { apikey: 'sb_secret_x', 'Content-Type': 'application/json' });
  assert.equal(serverHeaders('eyJhbGciOi.legacy').Authorization, 'Bearer eyJhbGciOi.legacy');
});

test('config: Supabase is optional; secret key preferred over the legacy one', () => {
  assert.equal(loadConfig({}).supabaseUrl, '');
  const c = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_a', SUPABASE_SERVICE_ROLE_KEY: 'legacy', SUPABASE_ANON_KEY: 'anon' });
  assert.equal(c.supabaseKey, 'sb_secret_a');
  assert.equal(c.supabasePublishableKey, 'anon');
});

test('disabled without URL or key: no calls, clear error', async () => {
  const f = fakeFetch(() => [200, []]);
  const db = createSupabase({ url: '', key: 'k', fetchImpl: f });
  assert.equal(db.enabled, false);
  assert.equal(await db.getUser('token'), null);
  await assert.rejects(db.getAccount('u1'), /aren’t set up/);
  assert.equal(f.calls.length, 0);
});

test('getUser asks Supabase Auth with the user’s token, and caches for a minute', async () => {
  let t = 0;
  const f = fakeFetch((c) => (c.headers.Authorization === 'Bearer good' ? [200, { id: 'u1', email: 'a@example.com' }] : [401, { msg: 'bad jwt' }]));
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f, now: () => t });
  assert.deepEqual(await db.getUser('good'), { id: 'u1', email: 'a@example.com' });
  assert.equal(f.calls[0].url, 'https://abc.supabase.co/auth/v1/user');
  assert.equal(f.calls[0].headers.apikey, 'sb_secret_k');
  await db.getUser('good');
  assert.equal(f.calls.length, 1); // cached
  t = 61_000;
  await db.getUser('good');
  assert.equal(f.calls.length, 2); // expired
  assert.equal(await db.getUser('bad'), null);
  assert.equal(await db.getUser(''), null);
});

test('getAccount reads, and creates the row if the trigger hasn’t', async () => {
  const f = fakeFetch((c) => (c.method === 'GET' ? [200, []] : [201, [{ user_id: 'u1', email: 'a@example.com', credits: 0 }]]));
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f });
  const acc = await db.getAccount('u1', 'a@example.com');
  assert.equal(acc.credits, 0);
  assert.equal(f.calls[0].url, 'https://abc.supabase.co/rest/v1/accounts?user_id=eq.u1&select=*');
  assert.equal(f.calls[1].method, 'POST');
  assert.match(f.calls[1].headers.Prefer, /merge-duplicates/);
});

test('spend and grant go through the database functions', async () => {
  const f = fakeFetch((c) => [200, c.url.endsWith('spend_credits') ? 7 : 40]);
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f });
  assert.equal(await db.spendCredits('u1', 1.2, 'Live session', { floor: -2, ref: 'session:s1' }), 7);
  assert.deepEqual(f.calls[0].body, { p_user: 'u1', p_amount: 1, p_reason: 'Live session', p_floor: -2, p_ref: 'session:s1' });
  assert.equal(await db.grantCredits('u1', 30, 'Purchase', 'paddle:txn_1', { amountCents: 900 }), 40);
  assert.deepEqual(f.calls[1].body, { p_user: 'u1', p_amount: 30, p_reason: 'Purchase', p_ref: 'paddle:txn_1', p_amount_cents: 900 });
  await assert.rejects(db.grantCredits('u1', 5, 'x', ''), /needs a ref/);
});

test('database errors carry the status and body', async () => {
  const f = fakeFetch(() => [500, { message: 'boom' }]);
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f });
  await assert.rejects(db.listLedger('u1'), (e) => e.status === 500 && /boom/.test(e.body));
});

test('checkSchema names missing tables', async () => {
  const f = fakeFetch((c) =>
    /trial_claims|api_costs/.test(c.url) ? [404, { code: 'PGRST205', message: 'Could not find the table' }] : [200, []],
  );
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f });
  assert.deepEqual(await db.checkSchema(), ['trial_claims', 'api_costs']);
  const bad = createSupabase({ url: URL_, key: 'wrong', fetchImpl: fakeFetch(() => [401, { message: 'Invalid API key' }]) });
  await assert.rejects(bad.checkSchema(), (e) => e.status === 401);
});

test('trial claims and cost rows', async () => {
  const f = fakeFetch((c) => [c.method === 'GET' ? 200 : 201, c.method === 'GET' ? [{ id: 1 }, { id: 2 }] : '']);
  const db = createSupabase({ url: URL_, key: 'sb_secret_k', fetchImpl: f });
  assert.equal(await db.countTrialClaims('email', 'h1', '2026-01-01T00:00:00Z'), 2);
  assert.match(f.calls[0].url, /kind=eq\.email&key_hash=eq\.h1&created_at=gte\.2026-01-01T00%3A00%3A00Z/);
  await db.insertApiCosts([{ activity: 'report', provider: 'anthropic' }]);
  assert.equal(f.calls[1].method, 'POST');
  assert.equal(await db.insertApiCosts([]), null);
  assert.equal(f.calls.length, 2);
});
