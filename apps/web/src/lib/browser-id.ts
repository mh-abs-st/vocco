// A random id for this browser, kept in localStorage. Only used so free credits are given once per browser
// (#11); the server stores a keyed hash of it, never the id itself.

const KEY = 'vocco.browser.v1';

export function browserId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}
