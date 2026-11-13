// Supabase over plain REST (no SDK): check who a user is, read accounts, spend and grant credits, trial claims,
// cost rows. Uses the server's secret key, which bypasses row level security: server only, never the browser.
// Adapted from Offro's backend/supabase.js; settings come in as arguments so tests can fake `fetch`.

/**
 * The server key is a secret key ("sb_secret_…", Project settings → API Keys) or the legacy service_role JWT.
 * A secret key goes on the `apikey` header only (Supabase refuses it as a Bearer token); the legacy JWT goes on both.
 */
export const isSecretKey = (key) => /^sb_secret_/.test(String(key || ''));
export function serverHeaders(key) {
  return isSecretKey(key)
    ? { apikey: key, 'Content-Type': 'application/json' }
    : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export class DatabaseError extends Error {
  constructor(message, { status = 0, body = '' } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const enc = encodeURIComponent;

/**
 * @param {{ url?: string, key?: string, fetchImpl?: typeof fetch, now?: () => number }} opts
 */
export function createSupabase({ url = '', key = '', fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const base = String(url).replace(/\/+$/, '');
  const enabled = Boolean(base && key);

  async function rest(path, { method = 'GET', body, prefer } = {}) {
    if (!enabled) throw new DatabaseError('Accounts aren’t set up on this server (no SUPABASE_URL / SUPABASE_SECRET_KEY).');
    const res = await fetchImpl(`${base}/rest/v1/${path}`, {
      method,
      headers: { ...serverHeaders(key), ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new DatabaseError(`Database error ${res.status}`, { status: res.status, body: text.slice(0, 500) });
    return text ? JSON.parse(text) : null;
  }
  const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: args });

  // Who is this? Supabase checks the user's session token. Cached for a minute per token.
  const userCache = new Map();
  async function getUser(accessToken) {
    if (!enabled || !accessToken) return null;
    const hit = userCache.get(accessToken);
    if (hit && hit.until > now()) return hit.user;
    // The project key on apikey, the user's session (a JWT) as the Bearer token: the same with either key type.
    const res = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const u = await res.json();
    if (!u?.id) return null;
    const user = { id: u.id, email: u.email || '' };
    if (userCache.size > 5000) userCache.clear();
    userCache.set(accessToken, { user, until: now() + 60_000 });
    return user;
  }

  return {
    enabled,
    getUser,

    /** The user's account; created here if the signup trigger hasn't made it (it normally has). */
    async getAccount(userId, email = '') {
      const rows = await rest(`accounts?user_id=eq.${enc(userId)}&select=*`);
      if (rows?.[0]) return rows[0];
      const created = await rest('accounts', { method: 'POST', body: { user_id: userId, email }, prefer: 'resolution=merge-duplicates,return=representation' });
      return created?.[0] || { user_id: userId, email, credits: 0 };
    },
    updateAccount: (userId, fields) =>
      rest(`accounts?user_id=eq.${enc(userId)}`, { method: 'PATCH', body: { ...fields, updated_at: new Date(now()).toISOString() } }),

    /** Spend atomically. Returns the new balance, or null when it would go below `floor`. */
    async spendCredits(userId, amount, reason, { floor = 0, ref = null } = {}) {
      return rpc('spend_credits', { p_user: userId, p_amount: Math.round(amount), p_reason: reason, p_floor: floor, p_ref: ref });
    },
    /** Grant once per `ref`. Returns the new balance (unchanged when that ref was already granted). */
    async grantCredits(userId, amount, reason, ref, { amountCents = null } = {}) {
      if (!ref) throw new DatabaseError('A grant needs a ref.');
      return rpc('grant_credits', { p_user: userId, p_amount: Math.round(amount), p_reason: reason, p_ref: ref, p_amount_cents: amountCents });
    },
    listLedger: async (userId, limit = 20) =>
      (await rest(`credit_ledger?user_id=eq.${enc(userId)}&select=delta,reason,ref,balance_after,created_at&order=updated_at.desc&limit=${limit}`)) || [],
    hasLedgerRef: async (ref) => Boolean((await rest(`credit_ledger?ref=eq.${enc(ref)}&select=id&limit=1`))?.length),

    // Free trial claims (#11): keyed hashes only.
    async countTrialClaims(kind, keyHash, sinceIso) {
      const rows = await rest(`trial_claims?kind=eq.${enc(kind)}&key_hash=eq.${enc(keyHash)}&created_at=gte.${enc(sinceIso)}&select=id&limit=100`);
      return rows?.length || 0;
    },
    addTrialClaims: (rows) => rest('trial_claims', { method: 'POST', body: rows }),

    /** Delete a user from Supabase Auth; their account and ledger go with them (on delete cascade). */
    async deleteUser(userId) {
      if (!enabled) throw new DatabaseError('Accounts aren’t set up on this server.');
      const res = await fetchImpl(`${base}/auth/v1/admin/users/${enc(userId)}`, { method: 'DELETE', headers: serverHeaders(key) });
      if (!res.ok && res.status !== 404) throw new DatabaseError(`Auth error ${res.status}`, { status: res.status, body: (await res.text()).slice(0, 500) });
      for (const [token, hit] of userCache) if (hit.user.id === userId) userCache.delete(token);
    },

    /** All rows of a table created in [fromIso, toIso), read in pages (Supabase returns at most 1000 at a time). */
    async listBetween(table, select, fromIso, toIso, pageSize = 1000) {
      const out = [];
      for (let offset = 0; ; offset += pageSize) {
        const rows = (await rest(`${table}?select=${select}&created_at=gte.${enc(fromIso)}&created_at=lt.${enc(toIso)}&order=created_at.asc&limit=${pageSize}&offset=${offset}`)) || [];
        out.push(...rows);
        if (rows.length < pageSize || out.length >= 200_000) return out;
      }
    },
    /** Emails for these users (the admin page's top users). */
    async emailsFor(ids) {
      const list = [...new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
      const map = {};
      for (let i = 0; i < list.length; i += 100) {
        const rows = (await rest(`accounts?select=user_id,email&user_id=in.(${list.slice(i, i + 100).join(',')})`)) || [];
        for (const r of rows) map[r.user_id] = r.email || '';
      }
      return map;
    },

    // Cost rows (#12): numbers only.
    insertApiCosts: (rows) => (rows.length ? rest('api_costs', { method: 'POST', body: rows }) : null),

    /**
     * Is the schema there? Reads one row from each table (none need to exist). Returns the names of missing
     * tables, or [] when all is well. Used at start-up so a missing schema says so clearly.
     */
    async checkSchema() {
      const missing = [];
      for (const table of ['accounts', 'credit_ledger', 'trial_claims', 'api_costs']) {
        try {
          await rest(`${table}?select=*&limit=1`);
        } catch (err) {
          if (err.status === 404 || /PGRST205|does not exist|Could not find the table/i.test(err.body || '')) missing.push(table);
          else throw err;
        }
      }
      return missing;
    },
  };
}
