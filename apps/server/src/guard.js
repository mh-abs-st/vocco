// Abuse limits: open sessions and reports per hour, counted per key. Keys are an address ("1.2.3.4") and, when
// someone is signed in, also their user ("user:<id>"): both must be under the limit. In memory: fine for one server.

export function createGuard({ maxSocketsPerIp = 2, reportsPerHourPerIp = 20, now = () => Date.now() } = {}) {
  const sockets = new Map(); // ip → open session count
  const reports = new Map(); // ip → timestamps in the last hour

  return {
    /** Take a session slot; false when this key (address or user) already has its maximum open. */
    openSession(ip) {
      const n = sockets.get(ip) || 0;
      if (n >= maxSocketsPerIp) return false;
      sockets.set(ip, n + 1);
      return true;
    },
    closeSession(ip) {
      const n = (sockets.get(ip) || 0) - 1;
      if (n > 0) sockets.set(ip, n);
      else sockets.delete(ip);
    },
    openSessions: (ip) => sockets.get(ip) || 0,
    /** Count a report request for every key; false (and nothing counted) when any is over the hourly limit. */
    allowReport(...keys) {
      const t = now();
      const recent = keys.map((k) => (reports.get(k) || []).filter((x) => t - x < 3600_000));
      if (recent.some((r) => r.length >= reportsPerHourPerIp)) {
        keys.forEach((k, i) => reports.set(k, recent[i]));
        return false;
      }
      keys.forEach((k, i) => reports.set(k, [...recent[i], t]));
      return true;
    },
  };
}

/** The client's address: the socket's, or the first X-Forwarded-For entry behind a trusted proxy. */
export function clientIp(req, trustProxy = false) {
  const fwd = trustProxy ? String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return fwd || req.socket?.remoteAddress || 'unknown';
}

/** Is this browser origin allowed? An empty list allows any (local work). */
export function originAllowed(origin, allowed) {
  if (!allowed?.length) return true;
  return Boolean(origin) && allowed.includes(origin);
}
