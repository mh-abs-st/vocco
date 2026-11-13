// Where to go after signing in. Signing in leaves the page (an email link, Google), so the screen the person was
// heading to is kept in localStorage for a short while and resumed when they come back signed in.

import type { Screen } from '../App';

const KEY = 'vocco.next.v1';
const TTL_MS = 30 * 60_000;

export function rememberNext(next?: Screen) {
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify({ next, until: Date.now() + TTL_MS }));
    else localStorage.removeItem(KEY);
  } catch {}
}

/** The remembered screen (once), or null. */
export function takeNext(): Screen | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.until > Date.now() ? v.next : null;
  } catch {
    return null;
  }
}
