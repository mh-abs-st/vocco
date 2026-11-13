// Free credits: a new account gets FREE_CREDITS once, unless this browser, network or email already had them.
// Stops the "new email, new free minutes" loop without bothering honest people. Adapted from Offro's trial.js.
//
//  - browser: a random id the web app keeps in localStorage (sent as the `x-vocco-browser` header)
//  - network: the IP address (IPv6: its /64), at most PER_NETWORK trials in NETWORK_DAYS days, so a shared
//    office, school or university network still works for a few people
//  - email: Gmail dots and "+tags" count as the same inbox; throwaway-inbox domains get no free credits
// Only keyed hashes are stored (never the raw IP address, browser id or email), in public.trial_claims.

import crypto from 'node:crypto';
import { FREE_CREDITS } from './plans.js';

export const PER_NETWORK = 3;
export const NETWORK_DAYS = 30;

// Common throwaway-inbox services. Not complete: extend with TRIAL_BLOCKED_DOMAINS (comma-separated).
const DISPOSABLE = [
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net',
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tempail.com', 'temp-mail.io', 'tmpmail.org', 'tmpmail.net', 'yopmail.com', 'yopmail.net',
  'yopmail.fr', 'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com',
  'mintemail.com', 'mohmal.com', 'emailondeck.com', 'fakeinbox.com', 'spamgourmet.com', 'mailcatch.com', 'moakt.com', 'tempinbox.com', 'burnermail.io',
  'inboxkitten.com', 'mail.tm', 'mail.gw', 'emltmp.com', 'dropmail.me', '1secmail.com', '1secmail.net', '1secmail.org', 'mailpoof.com', 'fexpost.com',
  'tempr.email', 'discard.email', 'harakirimail.com', 'spambox.us', 'byom.de', 'trbvm.com', 'cuvox.de', 'armyspy.com', 'dayrep.com', 'einrot.com',
  'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com', 'teleworm.us',
];

/** The same inbox written differently counts once: lower case, no "+tag", and for Gmail no dots. */
export function normalizeEmail(email) {
  const [local = '', domainRaw = ''] = String(email || '').trim().toLowerCase().split('@');
  const domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
  let user = local.split('+')[0];
  if (domain === 'gmail.com') user = user.replace(/\./g, '');
  return user && domain ? `${user}@${domain}` : '';
}

/** The network: an IPv4 address, or the /64 of an IPv6 address (one home or office usually has one /64). */
export function networkOf(ip) {
  const a = String(ip || '').trim().replace(/^::ffff:/i, '');
  if (!a) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return a;
  if (a.includes(':')) {
    const [head, tail = ''] = a.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
    return `${full.slice(0, 4).map((x) => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
  }
  return '';
}

/** A browser id from the web app: a uuid-like token, or '' if it's missing or odd. */
export const cleanBrowserId = (v) => (/^[A-Za-z0-9-]{16,64}$/.test(String(v || '')) ? String(v) : '');

const MESSAGES = {
  browser: 'Free credits were already used in this browser.',
  network: 'Free credits were already used several times on this network.',
  email: 'Free credits were already used with this email address.',
  disposable: 'Free credits aren’t available for temporary email addresses. Sign in with your usual email.',
};
export const trialMessage = (reason) => MESSAGES[reason] || '';

/**
 * @param {{ db: ReturnType<import('./supabase.js').createSupabase>, secret: string, freeCredits?: number,
 *           blockedDomains?: string[], now?: () => number, log?: (l: string) => void }} opts
 */
export function createTrial({ db, secret, freeCredits = FREE_CREDITS, blockedDomains = [], now = () => Date.now(), log = console.log }) {
  if (!secret) throw new Error('createTrial needs a secret for the hashes.');
  const keyHash = (kind, value) => crypto.createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex').slice(0, 40);
  const blocked = [...DISPOSABLE, ...blockedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean)];
  const isDisposable = (email) => {
    const domain = String(email || '').toLowerCase().split('@')[1] || '';
    return blocked.some((d) => domain === d || domain.endsWith(`.${d}`));
  };

  /** May this new account get the free credits? */
  async function decide({ email, browserId, ip }) {
    if (isDisposable(email)) return { ok: false, reason: 'disposable' };
    const t = now();
    const keys = [];
    const mail = normalizeEmail(email);
    if (mail) keys.push({ kind: 'email', hash: keyHash('email', mail), max: 1, since: 0 });
    const browser = cleanBrowserId(browserId);
    if (browser) keys.push({ kind: 'browser', hash: keyHash('browser', browser), max: 1, since: 0 });
    const net = networkOf(ip);
    if (net) keys.push({ kind: 'network', hash: keyHash('network', net), max: PER_NETWORK, since: t - NETWORK_DAYS * 864e5 });
    for (const k of keys) {
      if ((await db.countTrialClaims(k.kind, k.hash, new Date(k.since).toISOString())) >= k.max) return { ok: false, reason: k.kind };
    }
    return { ok: true, claims: keys.map((k) => ({ kind: k.kind, key_hash: k.hash })) };
  }

  /**
   * Once per account (on its first /api/me): grant the free credits, or record why not.
   * @returns {Promise<{ status: 'granted' | 'denied', reason?: string, justGranted?: boolean, balance?: number }>}
   */
  async function claim({ user, account, browserId, ip }) {
    if (account.trial_status) {
      const [status, reason] = String(account.trial_status).split(':');
      return { status: status === 'granted' ? 'granted' : 'denied', ...(reason ? { reason } : {}) };
    }
    const ref = `welcome:${user.id}`;
    // Already granted (e.g. two requests at once): just record it.
    if (await db.hasLedgerRef(ref)) {
      await db.updateAccount(user.id, { trial_status: 'granted' });
      return { status: 'granted' };
    }
    const d = await decide({ email: user.email, browserId, ip });
    if (!d.ok) {
      await db.updateAccount(user.id, { trial_status: `denied:${d.reason}` });
      log(`[trial] denied (${d.reason})`);
      return { status: 'denied', reason: d.reason };
    }
    const balance = await db.grantCredits(user.id, freeCredits, 'Free credits', ref);
    await db.addTrialClaims(d.claims.map((c) => ({ ...c, user_id: user.id })));
    await db.updateAccount(user.id, { trial_status: 'granted' });
    return { status: 'granted', justGranted: true, ...(typeof balance === 'number' ? { balance } : {}) };
  }

  return { decide, claim, keyHash };
}

/** The secret for the hashes: TRIAL_SECRET, or (dev) one derived from the server key. */
export function trialSecret(config) {
  return config.trialSecret || crypto.createHash('sha256').update(`vocco-trial:${config.supabaseKey || 'dev'}`).digest('hex');
}
