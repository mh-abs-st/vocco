// What each request cost us: Claude tokens and speech-to-text seconds, in dollars. Recorded in public.api_costs
// (numbers only: never a transcript or a report), shown on /admin/usage. Prices adapted from Offro's costs.js;
// check them against the vendors' pricing pages when they change.

// Claude, $ per million tokens.
export const MODEL_PRICES = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};
const FALLBACK = MODEL_PRICES['claude-sonnet-5-5']; // an unknown model is priced like Sonnet

// Deepgram streaming, $ per minute of audio (pay-as-you-go list price).
export const STT_PRICES = { 'nova-3': 0.0077 };
const STT_FALLBACK = STT_PRICES['nova-3'];

const r6 = (n) => Math.round(n * 1e6) / 1e6;

/** A Claude response's usage → token counts and dollars. */
export function claudeCost(model, usage = {}) {
  const p = MODEL_PRICES[model] || MODEL_PRICES[String(model || '').replace(/-\d{8}$/, '')] || FALLBACK;
  const input = (Number(usage.input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0) + (Number(usage.cache_creation_input_tokens) || 0);
  const output = Number(usage.output_tokens) || 0;
  return { input, output, usd: r6((input * p.input + output * p.output) / 1e6) };
}

/** Seconds of speech-to-text → dollars. */
export const sttCost = (model, seconds) => r6(((Math.max(0, Number(seconds) || 0) / 60) * (STT_PRICES[model] ?? STT_FALLBACK)));

/**
 * Collects cost rows and writes them in small batches (every few seconds), so recording never slows a session or a
 * report. Without a database it only logs (when LOG_USAGE=1).
 * @param {{ db?: { enabled: boolean, insertApiCosts: (rows: object[]) => Promise<unknown> } | null, log?: (l: string) => void,
 *           logUsage?: boolean, flushMs?: number }} opts
 */
export function createCostRecorder({ db = null, log = console.log, logUsage = false, flushMs = 5000 } = {}) {
  let queue = [];
  let timer = null;

  async function flush() {
    timer = null;
    if (!queue.length) return;
    const rows = queue;
    queue = [];
    try {
      await db.insertApiCosts(rows);
    } catch (err) {
      log(`[costs] couldn't save ${rows.length} rows: ${err?.message}`); // numbers only; losing a few is fine
    }
  }

  return {
    /** One row (see api_costs in db/schema.sql). */
    record(row) {
      const full = { input_tokens: 0, output_tokens: 0, audio_seconds: 0, characters: 0, model: '', ...row, cost_usd: r6(row.cost_usd || 0) };
      if (logUsage) {
        const what = full.provider === 'deepgram' ? `seconds=${Number(full.audio_seconds).toFixed(1)}` : `in=${full.input_tokens} out=${full.output_tokens}`;
        log(`[usage] ${full.activity} ${full.provider} ${full.model} ${what} ~$${full.cost_usd.toFixed(4)}`);
      }
      if (!db?.enabled) return;
      queue.push(full);
      if (queue.length >= 50) void flush();
      else if (!timer) {
        timer = setTimeout(flush, flushMs);
        timer.unref?.();
      }
    },
    flush,
    pending: () => queue.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// /admin/usage: the numbers for a period.

const day = (iso) => String(iso).slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ costs: any[], ledger: any[], emails?: Record<string, string> }} data
 *   costs: api_costs rows; ledger: credit_ledger rows (delta, reason, ref, amount_cents, user_id, created_at)
 */
export function summarizeUsage({ costs, ledger, emails = {} }) {
  const total = { costUsd: 0, revenueUsd: 0, sessions: 0, audioMinutes: 0, reports: 0, creditsSpent: 0, creditsFree: 0, creditsBought: 0, purchases: 0 };
  const byModel = {};
  const byDay = {};
  const byUser = {};
  const d = (k) => (byDay[k] ||= { date: k, costUsd: 0, revenueUsd: 0, sessions: 0, audioMinutes: 0, reports: 0 });
  const u = (id) => (byUser[id || '(deleted)'] ||= { userId: id || '(deleted)', email: emails[id] || '', costUsd: 0, audioMinutes: 0, reports: 0, creditsSpent: 0, revenueUsd: 0 });

  for (const c of costs) {
    const usd = Number(c.cost_usd) || 0;
    total.costUsd += usd;
    const key = `${c.provider} ${c.model}`.trim();
    const m = (byModel[key] ||= { key, costUsd: 0, requests: 0 });
    m.costUsd += usd;
    m.requests++;
    const row = d(day(c.created_at));
    row.costUsd += usd;
    const who = u(c.user_id);
    who.costUsd += usd;
    if (c.provider === 'deepgram') {
      const min = (Number(c.audio_seconds) || 0) / 60;
      total.sessions++;
      total.audioMinutes += min;
      row.sessions++;
      row.audioMinutes += min;
      who.audioMinutes += min;
    }
    if (c.activity === 'report') {
      total.reports++;
      row.reports++;
      who.reports++;
    }
  }
  for (const l of ledger) {
    const delta = Number(l.delta) || 0;
    if (delta < 0) {
      total.creditsSpent += -delta;
      u(l.user_id).creditsSpent += -delta;
    } else if (l.amount_cents != null) {
      const usd = (Number(l.amount_cents) || 0) / 100;
      total.creditsBought += delta;
      total.revenueUsd += usd;
      total.purchases++;
      d(day(l.created_at)).revenueUsd += usd;
      u(l.user_id).revenueUsd += usd;
    } else total.creditsFree += delta;
  }
  // Dollar costs keep their small digits (a session costs fractions of a cent); other numbers get 2 decimals.
  const fin = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? (k === 'costUsd' ? r6(v) : round2(v)) : v]));
  return {
    total: { ...fin(total), costUsd: r6(total.costUsd), profitUsd: round2(total.revenueUsd - total.costUsd), costPerMinuteUsd: total.audioMinutes ? r6(costsOf(costs, 'deepgram') / total.audioMinutes) : 0, costPerReportUsd: total.reports ? r6(costsOf(costs, 'anthropic') / total.reports) : 0 },
    byModel: Object.values(byModel).sort((a, b) => b.costUsd - a.costUsd).map((m) => ({ ...m, costUsd: r6(m.costUsd) })),
    byDay: Object.values(byDay).sort((a, b) => (a.date < b.date ? 1 : -1)).map(fin),
    topUsers: Object.values(byUser).sort((a, b) => b.costUsd - a.costUsd).slice(0, 20).map(fin),
  };
}
const costsOf = (rows, provider) => rows.filter((r) => r.provider === provider).reduce((n, r) => n + (Number(r.cost_usd) || 0), 0);
