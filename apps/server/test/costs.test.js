import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { claudeCost, sttCost, createCostRecorder, summarizeUsage } from '../src/costs.js';
import { isLocal, tokenOk, periodRange, renderUsage, handleAdmin } from '../src/admin.js';
import { writeReport } from '../src/report.js';
import { loadConfig } from '../src/config.js';

test('prices: Claude tokens and speech-to-text minutes', () => {
  assert.deepEqual(claudeCost('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 }), { input: 1_000_000, output: 100_000, usd: 3 });
  assert.equal(claudeCost('claude-haiku-5-5', { input_tokens: 2000, output_tokens: 1000 }).usd, 0.0007);
  assert.equal(claudeCost('something-new', { input_tokens: 1_000_000 }).usd, 2); // unknown → priced like Sonnet
  assert.equal(sttCost('nova-3', 120), 0.0154);
  assert.equal(sttCost('nova-3', -5), 0);
});

test('the recorder batches rows and never throws', async () => {
  const saved = [];
  let fail = false;
  const db = { enabled: true, insertApiCosts: async (rows) => { if (fail) throw new Error('down'); saved.push(...rows); } };
  const logs = [];
  const rec = createCostRecorder({ db, log: (l) => logs.push(l), flushMs: 10_000 });
  rec.record({ activity: 'report', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 10, cost_usd: 0.1234567 });
  assert.equal(saved.length, 0); // waits for the batch
  assert.equal(rec.pending(), 1);
  await rec.flush();
  assert.equal(saved[0].cost_usd, 0.123457);
  assert.equal(saved[0].audio_seconds, 0);
  fail = true;
  rec.record({ activity: 'session', provider: 'deepgram', audio_seconds: 30, cost_usd: 0.004 });
  await rec.flush();
  assert.match(logs.at(-1), /couldn't save 1 rows/);
  const off = createCostRecorder({ db: null, logUsage: true, log: (l) => logs.push(l) });
  off.record({ activity: 'session', provider: 'deepgram', model: 'nova-3', audio_seconds: 30, cost_usd: 0.00385 });
  assert.equal(off.pending(), 0);
  assert.match(logs.at(-1), /\[usage\] session deepgram nova-3 seconds=30.0/);
});

test('a report records its tokens and cost', async () => {
  const rows = [];
  const costs = { record: (r) => rows.push(r) };
  const fetchImpl = async () => new Response(JSON.stringify({ stop_reason: 'tool_use', usage: { input_tokens: 1500, output_tokens: 800 }, content: [{ type: 'tool_use', name: 'speech_report', input: { headline: 'x', scores: {}, strengths: [], fixes: [], stronger: {}, drills: [] } }] }), { status: 200 });
  await writeReport({ transcript: 'Hi.', summary: {} }, { config: loadConfig({ ANTHROPIC_API_KEY: 'k' }), fetchImpl, costs, userId: 'u1' });
  assert.deepEqual(rows, [{ user_id: 'u1', activity: 'report', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 1500, output_tokens: 800, cost_usd: 0.011 }]);
});

const COSTS = [
  { user_id: 'a', activity: 'session', provider: 'deepgram', model: 'nova-3', audio_seconds: 120, cost_usd: 0.0154, created_at: '2026-11-12T10:00:00Z' },
  { user_id: 'a', activity: 'report', provider: 'anthropic', model: 'claude-sonnet-5-5', input_tokens: 1500, output_tokens: 800, cost_usd: 0.011, created_at: '2026-11-12T10:03:00Z' },
  { user_id: 'b', activity: 'session', provider: 'deepgram', model: 'nova-3', audio_seconds: 60, cost_usd: 0.0077, created_at: '2026-11-13T09:00:00Z' },
];
const LEDGER = [
  { user_id: 'a', delta: 10, reason: 'Free credits', ref: 'welcome:a', amount_cents: null, created_at: '2026-11-12T09:59:00Z' },
  { user_id: 'a', delta: -2, reason: 'Live session', ref: 'session:1', created_at: '2026-11-12T10:00:00Z' },
  { user_id: 'a', delta: -2, reason: 'Coach’s notes', ref: 'report:a:1', created_at: '2026-11-12T10:03:00Z' },
  { user_id: 'b', delta: 60, reason: 'Purchase', ref: 'paddle:1', amount_cents: 900, created_at: '2026-11-13T08:00:00Z' },
  { user_id: 'b', delta: -1, reason: 'Live session', ref: 'session:2', created_at: '2026-11-13T09:00:00Z' },
];

test('usage summary: totals, profit, per day, per model, per person', () => {
  const s = summarizeUsage({ costs: COSTS, ledger: LEDGER, emails: { a: 'a@example.com' } });
  assert.equal(s.total.costUsd, 0.0341);
  assert.equal(s.total.revenueUsd, 9);
  assert.equal(s.total.profitUsd, 8.97);
  assert.equal(s.total.sessions, 2);
  assert.equal(s.total.audioMinutes, 3);
  assert.equal(s.total.reports, 1);
  assert.equal(s.total.creditsSpent, 5);
  assert.equal(s.total.creditsFree, 10);
  assert.equal(s.total.creditsBought, 60);
  assert.equal(s.total.costPerMinuteUsd, 0.0077);
  assert.equal(s.total.costPerReportUsd, 0.011);
  assert.deepEqual(s.byDay.map((d) => d.date), ['2026-11-13', '2026-11-12']);
  assert.equal(s.byModel[0].key, 'deepgram nova-3');
  assert.equal(s.topUsers[0].email, 'a@example.com');
  assert.equal(s.topUsers[0].creditsSpent, 4);
});

test('admin: local only, password, escaped', async () => {
  assert.equal(isLocal({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.equal(isLocal({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '1.2.3.4' } }), false); // through a proxy
  assert.equal(isLocal({ socket: { remoteAddress: '10.0.0.5' }, headers: {} }), false);
  const basic = (p) => ({ headers: { authorization: `Basic ${Buffer.from(`admin:${p}`).toString('base64')}` } });
  assert.equal(tokenOk(basic('s3cret'), 's3cret'), true);
  assert.equal(tokenOk(basic('wrong'), 's3cret'), false);
  assert.equal(tokenOk(basic('s3cret'), ''), false);
  const html = renderUsage({ s: summarizeUsage({ costs: COSTS, ledger: LEDGER, emails: { a: '<b>x</b>@example.com' } }), days: 7, accounts: true });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;@example.com'));
  assert.ok(!html.includes('<b>x</b>'));
  const { from, to } = periodRange(1, Date.parse('2026-11-13T15:00:00Z'));
  assert.equal(from, '2026-11-13T00:00:00.000Z');
  assert.ok(to > '2026-11-13T15:00:00');
});

test('admin page over HTTP: 404 without a token configured, 401 without the password, then the numbers', async () => {
  const listed = [];
  const db = {
    enabled: true,
    listBetween: async (table, _sel, from) => { listed.push([table, from]); return table === 'api_costs' ? COSTS : LEDGER; },
    emailsFor: async () => ({ a: 'a@example.com' }),
  };
  const serve = (config) => createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    if (!(await handleAdmin(req, res, url, { config, db }))) { res.writeHead(418); res.end(); }
  });
  for (const [config, expect] of [[{ adminToken: '' }, 404], [{ adminToken: 'tok' }, 401]]) {
    const srv = serve(config);
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    assert.equal((await fetch(`http://127.0.0.1:${srv.address().port}/admin/usage`)).status, expect);
    srv.close();
  }
  const srv = serve({ adminToken: 'tok' });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const auth = { authorization: `Basic ${Buffer.from('me:tok').toString('base64')}` };
  const r = await fetch(`${base}/admin/usage?days=30`, { headers: auth });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /\$8\.97/); // profit
  assert.match(html, /a@example\.com/);
  assert.deepEqual(listed.map((l) => l[0]).sort(), ['api_costs', 'credit_ledger']);
  assert.equal((await fetch(`${base}/admin/usage`, { headers: { ...auth, 'x-forwarded-for': '9.9.9.9' } })).status, 404); // via a proxy = not local
  assert.equal((await fetch(`${base}/somewhere`, { headers: auth })).status, 418); // not admin: passed on
  srv.close();
});
