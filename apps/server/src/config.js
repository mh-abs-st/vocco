// Settings from the environment (see .env.example). Read once at start-up; tests pass their own object.

const num = (v, d) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

export function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 8787),
    deepgramKey: env.DEEPGRAM_API_KEY || '',
    deepgramModel: env.DEEPGRAM_MODEL || 'nova-3',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    // Accounts and credits (#8). Empty = no accounts yet: everything works as before, without sign-in.
    supabaseUrl: env.SUPABASE_URL || '',
    // Server key: a secret key (sb_secret_…) or the legacy service_role key. Never sent to the browser.
    supabaseKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '',
    // Browser key for sign-in (#9): the publishable key (sb_publishable_…) or the legacy anon key. Safe to expose.
    supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '',
    // Free credits (#11): the key for the anonymous hashes. Set it once in production and never change it, or
    // earlier claims stop matching. Unset: derived from the Supabase key (fine for local work).
    trialSecret: env.TRIAL_SECRET || '',
    trialBlockedDomains: list(env.TRIAL_BLOCKED_DOMAINS),
    reportModel: env.REPORT_MODEL || 'claude-sonnet-5-5',
    // Browsers on these origins may connect. Empty = any (fine for local work, set it in production).
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    maxSessionMin: num(env.MAX_SESSION_MIN, 10),
    maxSocketsPerIp: num(env.MAX_SOCKETS_PER_IP, 2),
    reportsPerHourPerIp: num(env.REPORTS_PER_HOUR_PER_IP, 20),
    // Behind a proxy (Hostinger, Render, Fly…): trust X-Forwarded-For for the client address.
    trustProxy: env.TRUST_PROXY === '1',
    // Serve the built web app from here (one deploy for both). Empty = API only.
    webDist: env.WEB_DIST ?? '../web/dist',
    logUsage: env.LOG_USAGE === '1',
  };
}
