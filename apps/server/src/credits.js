// Credits: check before a session or report, charge live minutes and reports. Everything goes through the
// database functions (atomic, one ledger line per session / report), see db/schema.sql.

import { COSTS } from './plans.js';

/** @param {ReturnType<import('./supabase.js').createSupabase>} db */
export function createCredits(db, costs = COSTS) {
  return {
    costs,
    /** Current balance. */
    async balance(user) {
      return (await db.getAccount(user.id, user.email)).credits ?? 0;
    },
    /** Charge one live minute to this session's ledger line. New balance, or null when there aren't enough credits. */
    chargeMinute(user, sessionId) {
      return db.spendCredits(user.id, costs.livePerMinute, 'Live session', { floor: 0, ref: `session:${sessionId}` });
    },
    reportRef: (user, sessionId) => `report:${user.id}:${sessionId}`,
    /** Was this session's report already paid for? (Asking again is free.) */
    reportPaid(ref) {
      return db.hasLedgerRef(ref);
    },
    chargeReport(user, ref) {
      return db.spendCredits(user.id, costs.report, 'Coach’s notes', { floor: 0, ref });
    },
  };
}
