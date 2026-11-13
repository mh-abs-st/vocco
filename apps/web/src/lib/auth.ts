// Sign-in with Supabase Auth, over its REST API (no SDK). Two ways in: an email link, or Google.
// Both come back to this site with the session in the URL fragment (#access_token=…&refresh_token=…), which
// `init()` picks up and removes from the address bar. The session is kept in localStorage and refreshed before
// it runs out. When the server has no accounts (`/api/config` → accounts: false), everything here is off.

import { browserId } from './browser-id';

const base = (import.meta.env.VITE_API_URL as string | undefined) || '';
const KEY = 'vocco.auth.v1';

export type Pricing = { livePerMinute: number; report: number; freeCredits: number };
export type AuthConfig = { accounts: false } | { accounts: true; supabaseUrl: string; publishableKey: string; pricing?: Pricing };
export type Session = { accessToken: string; refreshToken: string; expiresAt: number; email: string; userId: string };
export type AuthState = {
  ready: boolean;
  accounts: boolean;
  session: Session | null;
  error: string;
  credits: number | null;
  pricing: Pricing | null;
  /** Free credits just arrived: a one-time welcome line. */
  welcome: string;
  /** Why there were no free credits (shown when someone is out of credits). */
  trialNote: string;
};

let config: AuthConfig | null = null;
let state: AuthState = { ready: false, accounts: false, session: null, error: '', credits: null, pricing: null, welcome: '', trialNote: '' };
const listeners = new Set<(s: AuthState) => void>();

function set(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}
export const getAuth = () => state;
export function onAuth(l: (s: AuthState) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function save(s: Session | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {}
}
function load(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && s.accessToken && s.refreshToken ? s : null;
  } catch {
    return null;
  }
}

/** Supabase Auth request with the publishable key. */
async function gotrue(path: string, init: RequestInit & { token?: string } = {}) {
  if (!config?.accounts) throw new Error('Accounts aren’t set up.');
  const headers: Record<string, string> = { apikey: config.publishableKey, 'content-type': 'application/json' };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return fetch(`${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
}

/** Ask Supabase who the token belongs to. */
async function whoIs(accessToken: string) {
  const res = await gotrue('user', { token: accessToken });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? { userId: String(u.id), email: String(u.email || '') } : null;
}

/** Read the server's config, take a session from the URL (after a sign-in link or Google), or restore one. */
export async function init() {
  try {
    const res = await fetch(`${base}/api/config`);
    config = res.ok ? await res.json() : { accounts: false };
  } catch {
    config = { accounts: false };
  }
  if (!config?.accounts) return set({ ready: true, accounts: false, session: null });
  set({ pricing: config.pricing ?? { livePerMinute: 1, report: 2, freeCredits: 0 } });

  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hash.get('error_description') || hash.get('error')) {
    history.replaceState(null, '', location.pathname + location.search);
    const why = hash.get('error_code') === 'otp_expired' ? 'That sign-in link has expired or was already used. Send a new one.' : 'Signing in didn’t work. Try again.';
    return set({ ready: true, accounts: true, session: load(), error: why });
  }
  if (hash.get('access_token') && hash.get('refresh_token')) {
    // Remove the tokens from the address bar (and history) right away.
    history.replaceState(null, '', location.pathname + location.search);
    const accessToken = hash.get('access_token')!;
    const who = await whoIs(accessToken).catch(() => null);
    if (who) {
      const s: Session = { accessToken, refreshToken: hash.get('refresh_token')!, expiresAt: Number(hash.get('expires_at')) || Date.now() / 1000 + Number(hash.get('expires_in') || 3600), ...who };
      save(s);
      set({ ready: true, accounts: true, session: s, error: '' });
      return void refreshCredits();
    }
    return set({ ready: true, accounts: true, session: null, error: 'Signing in didn’t work. Try again.' });
  }
  set({ ready: true, accounts: true, session: load() });
  if (state.session) void refreshCredits();
}

/** Ask the server for the balance (after sign-in, a session, a report). */
export async function refreshCredits() {
  const token = await accessToken();
  if (!token) return;
  // The browser id lets the server give free credits once per browser (it keeps only a hash).
  const res = await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}`, 'x-vocco-browser': browserId() } }).catch(() => null);
  if (res?.status === 401) return sessionRejected();
  if (!res?.ok) return;
  const me = await res.json();
  const credits = Number(me.credits) || 0;
  const trial = me.trial as { status?: string; justGranted?: boolean; message?: string } | undefined;
  set({
    credits,
    ...(trial?.justGranted ? { welcome: `Welcome! You have ${credits} free credits to start: 1 credit is 1 minute of speaking.` } : {}),
    trialNote: trial?.status === 'denied' ? trial.message || '' : '',
  });
}

export const dismissWelcome = () => set({ welcome: '' });

/** The server told us the new balance (e.g. after a report). */
export const setCredits = (credits: number) => set({ credits });

/** Where sign-in links and Google send people back to: this page. */
const returnUrl = () => `${location.origin}/`;

/** Email a sign-in link. Throws an Error with a message to show. */
export async function sendSignInLink(email: string) {
  const res = await gotrue(`otp?redirect_to=${encodeURIComponent(returnUrl())}`, {
    method: 'POST',
    body: JSON.stringify({ email: email.trim(), create_user: true }),
  }).catch(() => null);
  if (!res) throw new Error('Couldn’t reach the sign-in service. Check your connection and try again.');
  if (res.status === 429) throw new Error('Too many sign-in emails. Wait a minute, then try again.');
  if (!res.ok) throw new Error('That email address didn’t work. Check it and try again.');
}

/** The URL that starts "Continue with Google". */
export function googleSignInUrl() {
  if (!config?.accounts) return '';
  return `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(returnUrl())}`;
}

/** A valid access token (refreshed when it's within a minute of running out), or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const s = state.session;
  if (!s) return null;
  if (s.expiresAt - 60 > Date.now() / 1000) return s.accessToken;
  const res = await gotrue('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refreshToken }) }).catch(() => null);
  if (!res) return s.accessToken; // offline: try the old one, the server will say if it's no good
  if (!res.ok) {
    signedOut('You were signed out. Sign in again.');
    return null;
  }
  const j = await res.json();
  const next: Session = { ...s, accessToken: j.access_token, refreshToken: j.refresh_token || s.refreshToken, expiresAt: Number(j.expires_at) || Date.now() / 1000 + Number(j.expires_in || 3600) };
  save(next);
  set({ session: next });
  return next.accessToken;
}

function signedOut(error = '') {
  save(null);
  set({ session: null, error, credits: null, welcome: '', trialNote: '' });
}

/** The server said the token is no good (401): sign out locally. */
export const sessionRejected = () => signedOut('You were signed out. Sign in again.');

export async function signOut() {
  const token = state.session?.accessToken;
  signedOut();
  if (token) await gotrue('logout', { method: 'POST', token }).catch(() => {});
}

/** Delete the account on the server (Supabase user, account, credits). History in this browser stays. */
export async function deleteAccount() {
  const token = await accessToken();
  if (!token) throw new Error('Sign in again to delete your account.');
  const res = await fetch(`${base}/api/account`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res) throw new Error('Couldn’t reach Vocco. Check your connection and try again.');
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Your account couldn’t be deleted. Try again.');
  signedOut();
}

export const clearAuthError = () => set({ error: '' });
