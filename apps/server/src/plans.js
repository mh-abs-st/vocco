// Prices and credit costs, in one place (the server, the web app via /api/config, and later the pricing page).
// Same model as Offro: 1 credit = 1 live minute.

export const COSTS = {
  livePerMinute: 1, // charged at the start of every minute of audio (a started minute counts)
  report: 2, // the coach's notes, charged once per session, only when they're written
};

// Free credits for a new account (#11 grants them after the trial checks).
export const FREE_CREDITS = 10;

/** What the web app shows. */
export const publicPricing = () => ({ ...COSTS, freeCredits: FREE_CREDITS });
