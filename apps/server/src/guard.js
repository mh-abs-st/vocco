// Abuse limits that need no accounts yet: open sessions per address and reports per address per hour.
// In memory: fine for one server. Accounts and credits replace most of this later (see docs/PLAN.md, M0b).

export function createGuard({ maxSocketsPerIp = 2, reportsPerHourPerIp = 20, now = () => Date.now() } = {}) {
  const sockets = new Map(); // ip → open session count
  const reports = new Map(); // ip → timestamps in the last hour

  return {
    /** Take a session slot; false when this address already has its maximum open. */
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
    /** Count a report request; false when over the hourly limit. */
    allowReport(ip) {
      const t = now();
      const recent = (reports.get(ip) || []).filter((x) => t - x < 3600_000);
      if (recent.length >= reportsPerHourPerIp) {
        reports.set(ip, recent);
        return false;
      }
      recent.push(t);
      reports.set(ip, recent);
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
