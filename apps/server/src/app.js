// HTTP routes (plain node:http, no framework): health, topics, the report, and the built web app.
// The WebSocket for live sessions is attached in index.js.

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { TOPICS, CATEGORIES } from '@vocco/shared/topics';
import { checkReportBody, writeReport } from './report.js';
import { clientIp, originAllowed } from './guard.js';

const MAX_BODY = 200_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('bad json'), { status: 400 });
  }
}

/**
 * @param {ReturnType<import('./config.js').loadConfig>} config
 * @param {{ guard: ReturnType<import('./guard.js').createGuard>, db?: ReturnType<import('./supabase.js').createSupabase>, fetchImpl?: typeof fetch, log?: (l: string) => void, webRoot?: string }} deps
 */
export function createApp(config, deps) {
  const { guard } = deps;
  const db = deps.db?.enabled ? deps.db : null; // accounts on = sign-in required

  /** The signed-in user from `Authorization: Bearer <token>`, or null. */
  async function userFrom(req) {
    const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
    return m && db ? db.getUser(m[1].trim()) : null;
  }
  const log = deps.log || console.log;
  const webRoot = deps.webRoot ?? (config.webDist ? resolve(process.cwd(), config.webDist) : '');

  async function serveStatic(req, res, pathname) {
    if (!webRoot) return false;
    const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(webRoot, safe);
    if (!file.startsWith(webRoot)) return false;
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(webRoot, 'index.html'); // app routes → the app
    }
    try {
      const body = await readFile(file);
      const ext = extname(file);
      // Vite puts a content hash in asset names: cache those for a year, never index.html.
      const cache = file.includes(`${join(webRoot, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': cache });
      res.end(req.method === 'HEAD' ? undefined : body);
      return true;
    } catch {
      return false;
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://local');
    const origin = req.headers.origin;
    const cors = origin && originAllowed(origin, config.allowedOrigins) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'content-type, authorization', 'access-control-max-age': '600' });
        return res.end();
      }
      if (url.pathname === '/health') {
        return json(res, 200, { ok: true, listening: Boolean(config.deepgramKey), reports: Boolean(config.anthropicKey), accounts: Boolean(deps.db?.enabled) }, cors);
      }
      // What the web app needs to know before sign-in: are accounts on, and the public Supabase settings.
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, db ? { accounts: true, supabaseUrl: config.supabaseUrl, publishableKey: config.supabasePublishableKey } : { accounts: false }, cors);
      }
      if (url.pathname === '/api/me' && req.method === 'GET') {
        if (!db) return json(res, 404, { error: 'Accounts aren’t set up on this server.' }, cors);
        const user = await userFrom(req);
        if (!user) return json(res, 401, { error: 'Sign in again.' }, cors);
        const acc = await db.getAccount(user.id, user.email);
        return json(res, 200, { email: user.email, credits: acc.credits ?? 0 }, cors);
      }
      if (url.pathname === '/api/account' && req.method === 'DELETE') {
        if (!db) return json(res, 404, { error: 'Accounts aren’t set up on this server.' }, cors);
        if (origin && !originAllowed(origin, config.allowedOrigins)) return json(res, 403, { error: 'Not allowed from this site.' });
        const user = await userFrom(req);
        if (!user) return json(res, 401, { error: 'Sign in again to delete your account.' }, cors);
        await db.deleteUser(user.id);
        log(`[account] deleted ${user.id}`);
        return json(res, 200, { deleted: true }, cors);
      }
      if (url.pathname === '/api/topics' && req.method === 'GET') {
        return json(res, 200, { categories: CATEGORIES, topics: TOPICS }, { ...cors, 'cache-control': 'public, max-age=300' });
      }
      if (url.pathname === '/api/report' && req.method === 'POST') {
        if (origin && !originAllowed(origin, config.allowedOrigins)) return json(res, 403, { error: 'Not allowed from this site.' });
        const ip = clientIp(req, config.trustProxy);
        const user = await userFrom(req);
        if (db && !user) return json(res, 401, { error: 'Sign in again to get your report.' }, cors);
        if (!guard.allowReport(ip, ...(user ? [`user:${user.id}`] : []))) return json(res, 429, { error: 'That’s a lot of reports in an hour. Try again a bit later.' }, cors);
        const body = await readJson(req);
        const bad = checkReportBody(body);
        if (bad) return json(res, 400, { error: bad }, cors);
        if (!config.anthropicKey) return json(res, 503, { error: 'Reports aren’t set up on this server yet.' }, cors);
        try {
          const report = await writeReport(body, { config, fetchImpl: deps.fetchImpl, log });
          return json(res, 200, { report }, cors);
        } catch (err) {
          log(`[report] failed: ${err?.message}${err?.raw ? ` ${String(err.raw).slice(0, 200)}` : ''}`);
          const busy = err?.status === 429 || err?.status === 529;
          return json(res, 502, { error: busy ? 'The coach is busy right now. Try again in a minute.' : 'The report couldn’t be written. Try again.' }, cors);
        }
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' }, cors);
      if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, url.pathname))) return;
      return json(res, 404, { error: 'Not found.' });
    } catch (err) {
      const status = err?.status || 500;
      if (status === 500) log(`[http] ${req.method} ${url.pathname}: ${err?.stack || err}`);
      return json(res, status, { error: status === 413 ? 'Too much data.' : status === 400 ? 'Bad request.' : 'Something went wrong.' }, cors);
    }
  };
}
