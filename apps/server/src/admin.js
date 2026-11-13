// /admin/usage: usage, cost, credits, revenue and profit for a period, by day, model and person.
// Only on your own computer (the live server answers 404) and only with ADMIN_TOKEN: run the server locally against
// the production Supabase project to see live numbers. Plain server-rendered HTML; everything inserted is escaped.

import { summarizeUsage } from './costs.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => `$${(Number(n) || 0).toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
const num = (n, d = 0) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: d });
export const PERIODS = { 1: 'Today', 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 0: 'All time' };

/** A request from this computer, not through a proxy (a proxy adds X-Forwarded-For). */
export function isLocal(req) {
  const a = String(req.socket?.remoteAddress || '');
  const loopback = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  return loopback && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip'] && !req.headers.forwarded;
}

/** HTTP Basic auth: any user name, the password is ADMIN_TOKEN. */
export function tokenOk(req, token) {
  if (!token) return false;
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = Buffer.from(pass), b = Buffer.from(token);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0); // no early exit
  return diff === 0;
}

/** The period's [from, to) in ISO, from ?days= (1 = since midnight UTC, 0 = all time). */
export function periodRange(days, now = Date.now()) {
  const to = new Date(now + 1000).toISOString();
  if (!days) return { from: '2020-01-01T00:00:00.000Z', to };
  if (days === 1) return { from: new Date(new Date(now).toISOString().slice(0, 10)).toISOString(), to };
  return { from: new Date(now - days * 864e5).toISOString(), to };
}

export function renderUsage({ s, days, accounts }) {
  const t = s.total;
  const card = (label, value, hint = '', cls = '') => `<div class="card"><span>${esc(label)}</span><b${cls ? ` class="${cls}"` : ''}>${value}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
  const periods = Object.entries(PERIODS)
    .sort((a, b) => (Number(a[0]) || 1e9) - (Number(b[0]) || 1e9))
    .map(([d, l]) => `<a href="?days=${d}"${Number(d) === days ? ' aria-current="page"' : ''}>${esc(l)}</a>`)
    .join('');
  const rows = (list, cols) =>
    list.length ? list.map((r) => `<tr>${cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}">Nothing yet.</td></tr>`;
  const table = (title, list, cols) =>
    `<h2>${esc(title)}</h2><table><thead><tr>${cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows(list, cols)}</tbody></table>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vocco · Usage</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#1f2a44;background:#fbf8f3;margin:0;padding:24px;max-width:1100px}
h1{margin:0 0 4px}h2{margin:28px 0 8px;font-size:1.1rem}nav a{margin-right:12px;color:#5f6678}nav a[aria-current]{color:#1f2a44;font-weight:700}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:16px}
.card{background:#fff;border:1px solid #e8e2d8;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column}
.card span{font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:#5f6678}.card b{font-size:1.5rem}.card small{color:#5f6678}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #e8e2d8;border-radius:12px}th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #f0ebe2}
th{font-size:.8rem;color:#5f6678}td{font-variant-numeric:tabular-nums}.muted{color:#5f6678}.neg{color:#9a2f16}
</style></head><body>
<h1>Usage</h1><p class="muted">${esc(PERIODS[days] || '')}. Costs are recorded per request; revenue is what purchases actually cost the buyer. ${accounts ? '' : '<b>Supabase isn’t set up: nothing is recorded.</b>'}</p>
<nav>${periods}</nav>
<div class="cards">
${card('Profit', usd(t.profitUsd), 'revenue − cost', t.profitUsd < 0 ? 'neg' : '')}
${card('Revenue', usd(t.revenueUsd), `${num(t.purchases)} purchase${t.purchases === 1 ? '' : 's'}`)}
${card('Cost', usd(t.costUsd), 'speech-to-text + Claude')}
${card('Sessions', num(t.sessions), `${num(t.audioMinutes, 1)} minutes of audio`)}
${card('Reports', num(t.reports), `${usd(t.costPerReportUsd)} each`)}
${card('Speech-to-text', `${usd(t.costPerMinuteUsd)}/min`, 'cost per minute of audio')}
${card('Credits used', num(t.creditsSpent), `${num(t.creditsBought)} bought · ${num(t.creditsFree)} free`)}
</div>
${table('By day', s.byDay, [['Day', (r) => esc(r.date)], ['Sessions', (r) => num(r.sessions)], ['Minutes', (r) => num(r.audioMinutes, 1)], ['Reports', (r) => num(r.reports)], ['Cost', (r) => usd(r.costUsd)], ['Revenue', (r) => usd(r.revenueUsd)]])}
${table('By model', s.byModel, [['Provider and model', (r) => esc(r.key)], ['Requests', (r) => num(r.requests)], ['Cost', (r) => usd(r.costUsd)]])}
${table('Top people by cost', s.topUsers, [['Who', (r) => (r.email ? esc(r.email) : `<span class="muted">${esc(r.userId)}</span>`)], ['Minutes', (r) => num(r.audioMinutes, 1)], ['Reports', (r) => num(r.reports)], ['Credits used', (r) => num(r.creditsSpent)], ['Cost', (r) => usd(r.costUsd)], ['Paid', (r) => usd(r.revenueUsd)]])}
</body></html>`;
}

/**
 * Handle /admin/* (returns false when it isn't an admin path). 404 unless local and ADMIN_TOKEN is set.
 * @param {{ adminToken: string }} config
 * @param {ReturnType<import('./supabase.js').createSupabase> | null} db
 */
export async function handleAdmin(req, res, url, { config, db, now = Date.now() }) {
  if (!url.pathname.startsWith('/admin')) return false;
  const notFound = () => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  };
  if (!config.adminToken || !isLocal(req)) return notFound(), true; // the live server never shows it
  if (!tokenOk(req, config.adminToken)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="Vocco admin", charset="UTF-8"', 'content-type': 'text/plain' });
    res.end('Sign in with ADMIN_TOKEN as the password.');
    return true;
  }
  if (url.pathname !== '/admin' && url.pathname !== '/admin/usage') return notFound(), true;
  const days = Number(url.searchParams.get('days') ?? 7);
  const d = Object.hasOwn(PERIODS, String(days)) ? days : 7;
  let s = summarizeUsage({ costs: [], ledger: [] });
  if (db?.enabled) {
    const { from, to } = periodRange(d, now);
    const [costs, ledger] = await Promise.all([
      db.listBetween('api_costs', 'user_id,activity,provider,model,input_tokens,output_tokens,audio_seconds,cost_usd,created_at', from, to),
      db.listBetween('credit_ledger', 'user_id,delta,reason,ref,amount_cents,created_at', from, to),
    ]);
    const first = summarizeUsage({ costs, ledger });
    const emails = await db.emailsFor(first.topUsers.map((u) => u.userId)).catch(() => ({}));
    s = summarizeUsage({ costs, ledger, emails });
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  res.end(renderUsage({ s, days: d, accounts: Boolean(db?.enabled) }));
  return true;
}
