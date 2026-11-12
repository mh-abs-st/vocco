// Past sessions live in this browser only (localStorage), like Offro's History: nothing is stored on the server.

import type { SessionResult } from './types';

const KEY = 'vocco.history.v1';
const MAX = 30;

export function loadHistory(): SessionResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSession(s: SessionResult) {
  try {
    const list = loadHistory().filter((x) => x.id !== s.id);
    list.unshift(s);
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage full or blocked: the session still shows, it just isn't kept.
  }
}

export function deleteSession(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadHistory().filter((x) => x.id !== id)));
  } catch {}
}

const PREFS = 'vocco.prefs.v1';
export type Prefs = { minutes?: number; prepSeconds?: number; goals?: string[]; language?: string; deviceId?: string; baseline?: { speechDb?: number; pitchHz?: number } };

export function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}') || {};
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {}
}
