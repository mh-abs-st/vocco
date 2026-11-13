# Decisions and context

Why Vocco is the way it is, with the reasons, plus what's still open. Read this before changing the coaching
rules, the stack or the data handling. Add to it when a decision changes.

## Product

- **Separate product** (owner, 2026-11-12): own repo, brand, accounts and data. Offro is a reference for how the listening works, nothing more; copy and adapt, never import.
- **Name: Vocco** (owner, 2026-11-12). Title: *Vocco — Practice speaking out loud, with a coach that listens*. Domain and trademark not checked yet.
- **First mode: Coach** (talk on a topic). Debate, Q&A and Drills show as "Soon" on Home.
- **Accent is coached as clarity**, never as getting rid of an accent.

## Coaching

- **Cues are rules in the browser, not a model call** (2026-11-12): instant, free, testable, and they sit next to the pitch analysis, which has to run in the browser anyway. The server only relays audio and words. Thresholds: `RULES` in `packages/shared/src/engine.js`; change them there and in the tests.
- **One cue at a time, spaced out** (4–8 s on screen, ≥ 8 s between cues, same cue not within 25 s). More than that is distracting while speaking.
- **Only the chosen goals cue live** (default: pace + pauses); getting started is always coached. Everything is in the report either way.
- **Pace ignores long pauses** (gaps over 1 s are taken out of the time): a pause is coached as a pause, not as slow talking.
- **Pitch is relative to your own voice**: monotone = spread under 2 semitones over 15 s; the mic check (6 s, one line read aloud) records normal loudness and pitch for "Louder" and the pitch line.
- **"Not clear" words** use Deepgram's word confidence (< 0.55) for now. It's a weak signal (noise also lowers it); real pronunciation scoring is Azure in M3.
- **Times**: everything uses the mic's clock (seconds of audio since the mic started). The browser sends audio only after the server says `ready`, notes the mic time of the first chunk it sends on that connection, and adds it to every word time from Deepgram (which counts from that chunk). So word times and pitch frames share one clock, also after a reconnect.
- **A lost connection doesn't end the session** (#3, 2026-11-13): the transcript and numbers so far stay; the user picks **Keep going** (reconnect) or **Get my report**. The outage is recorded as a break: not a pause or hesitation, not talking time (pace, duration), not counted against the session length, and "Pick it back up" waits 6 s after reconnecting. What was said while offline isn't heard. The server reports Deepgram dropping mid-session as `error` with `reason: 'upstream'` instead of closing silently.

## Stack

- **Monorepo with npm workspaces**: `packages/shared` (plain JS + JSDoc types, no build step, usable by Node and Vite), `apps/server`, `apps/web`.
- **Server without a framework** (`node:http` + `ws`), Node ≥ 22: one runtime dependency, and the built-in WebSocket client talks to Deepgram (key sent as the `token` subprotocol). Claude is called over `fetch` (no SDK) so tests fake `fetch`, like Offro's.
- **Raw mic** (no echo cancellation, noise suppression or auto gain), like Offro: those filters change loudness and pitch, which is what we measure. When the partner speaks out loud (M4), turn echo cancellation on for that mode and recommend headphones.
- **16 kHz PCM from an AudioWorklet** (not MediaRecorder/WebM like Offro): the pitch analysis needs raw samples anyway, and Azure (M3) needs PCM.
- **Reports: Sonnet 5.5 with a strict, forced tool** and thinking off (`between_tools`), with fallbacks if the API refuses strict or forced tools (same lesson as Offro: without strict tools, nested results sometimes came back garbled).

## Report (#5, 2026-11-13)

- **Pace points every 5 s for talks under 90 s**, 10 s otherwise (`paceBucketSec`), so a 1-minute talk still shows a shape.
- **Every timeline flag points at a word** (`i`): cues at the last word heard when shown, hesitations at the word after the stop, fillers and unclear words at themselves. **Moments** (cues + hesitations) are clickable and highlight that word in the transcript; hesitations are also marked in the transcript with their length.
- **Try again goes straight into a new session** with the same topic and settings (and the newest mic-check numbers); **Change settings** goes to Setup.
- **"Last time"** under each stat = the previous session on the same topic (matched by the prompt text, so custom topics compare too), from the browser's history.

## Accessibility (#6, 2026-11-13)

- **Colours meet WCAG AA** for text: muted grey `#5f6678` (5.4:1 on the background), the live cue banner `--cue` `#c8452a` with white text (4.8:1; the lighter coral was 2.6:1), the "good pace" green `#1f7a5a` (5.3:1). Check new colours before adding them.
- **Keyboard:** everything is a real button, input or select; every focused control shows a 3px outline; a "Skip to content" link comes first; on each new screen, focus moves to its heading (`App.tsx`).
- **Choice chips are toggle buttons** (`aria-pressed`), not tabs: they don't behave like a tab list.
- **Screen readers on the live screen:** the visible cue box isn't a live region (it redraws a lot). A hidden status line announces only real changes: you're on, each new cue once, connection lost, reconnecting, writing the report. The pitch canvas is hidden from them; the pace chart and score bars have text equivalents.
- **Reduced motion** turns off transitions, hover movement and smooth scrolling.
- Checked with Playwright: a full session with the keyboard only, focus outlines, announcements. No automated checker (axe) in the cloud workspace yet — worth adding to CI.

## Browsers (#4, 2026-11-13)

- **Supported:** recent Chrome, Edge, Safari (macOS + iOS 14.5+) and Firefox, desktop and phone. Needs https (or localhost), `getUserMedia`, `AudioWorklet` and WebSocket; otherwise Home and Setup say so and Start is off (`apps/web/src/lib/support.ts`).
- **The audio context is created first, synchronously**, so when it starts from a click (mic check) Safari counts the click. A session starts after a screen change, so if the browser still keeps audio paused, a **Tap to start listening** panel appears over the session; nothing moves until then (no audio, no clock, the thinking time waits).
- **The worklet is connected to the speakers through a muted gain**: Safari only runs a worklet whose output leads somewhere. Nothing is heard.
- **The default sample rate is kept** (44.1 or 48 kHz); the worklet resamples to 16 kHz. Forcing `new AudioContext({ sampleRate: 16000 })` breaks in Firefox with a mic at another rate.
- **iOS interruptions** (a call, another app) pause audio; the context tries to resume on its own.
- **Phones:** on the live screen the pace and voice meters sit side by side above the transcript, so the cue and meters stay in view; the transcript scrolls inside its box, never the page.
- Checked automatically in Chromium only (desktop and a phone viewport, plus simulated paused audio and an old browser). Real Safari/Firefox/iPhone/Android runs are a manual checklist in #4.

## Privacy

- **Nothing is stored on the server.** Audio is relayed to Deepgram and not kept; the transcript and numbers are sent to Claude for the report and not kept. History and settings live in the browser's `localStorage`.
- **Deepgram `mip_opt_out=true`** on every stream: users' audio isn't used to train Deepgram's models.
- Write `PRIVACY.md` before launch; update it when accounts, recordings or new vendors (Azure, TTS) arrive.

## Accounts and credits (#8, 2026-11-13)

- **Vocco's own Supabase project**, set up by the owner from `docs/SUPABASE.md`; keys only in `.env` / the host, never in chat or the repo.
- **Schema in `db/schema.sql`**, safe to re-run. Credits change only through `spend_credits` / `grant_credits` (atomic, one ledger line per change; a `ref` makes grants idempotent and merges a session's minutes into one line). Users can only *read* their own account and ledger (row level security); only the server writes. The functions are revoked from `anon` / `authenticated` because Supabase lets them call public functions by default.
- **Tested on real Postgres**: `db/test/run.sh` applies the schema twice on top of a Supabase stand-in (`db/test/supabase-stub.sql`: `auth.users`, `auth.uid()`, the API roles and default grants) and checks credits and access. CI runs it on every push.
- **Server client over REST** (`apps/server/src/supabase.js`, no SDK, fake `fetch` in tests). Secret keys (`sb_secret_…`) go on `apikey` only; the legacy `service_role` JWT also as Bearer. Supabase is **optional**: without it the app runs as before (no sign-in); at start-up the server says whether it's connected and whether the tables exist.
- New users start at 0 credits; free credits come from the server after the trial checks (#11).

## Sign-in (#9, 2026-11-13)

- **When Supabase is set up, a session and a report need sign-in**; Home, topics, setup and past reports don't. Without Supabase, nothing changes (no sign-in anywhere). The web app learns which from `GET /api/config` (accounts on/off, the project URL and the publishable key — never the secret key).
- **Two ways in: an emailed link and Google.** No passwords.
- **Supabase Auth over its REST API, no SDK** (`apps/web/src/lib/auth.ts`): the sign-in link and Google both return with the session in the URL fragment, which is read once and removed from the address bar; the session is kept in localStorage and refreshed a minute before it runs out. (Adding `@supabase/supabase-js` would also need a new lockfile, which the cloud workspace can't make.)
- **Where you were going is kept for 30 minutes** (`lib/next.ts`), so pressing Start, signing in by email and opening the link goes straight into the session.
- **The server checks every session and report**: the token comes with the socket's `start` message and as `Authorization: Bearer` on `/api/report`; Supabase confirms it (cached for a minute). A rejected token signs the browser out with "Sign in again". Limits count per user as well as per address (1 user can't get round them by switching networks).
- **Delete account** (Account page, two steps) deletes the Supabase user; their account row and ledger go with it. Past sessions stay in the browser.

## Credits (#10, 2026-11-13)

- **1 credit = 1 started minute of speaking; the coach's notes are 2 credits.** One place: `apps/server/src/plans.js` (also sent to the web app in `/api/config`). Only when Supabase is set up; without it, nothing costs anything.
- **Live minutes are charged by the server from the audio it receives**, at the start of each minute (a started minute counts), all on one ledger line per session (`session:<id>`). A session needs a minute's credits to start. When the balance can't pay for another minute, the browser gets "This is your last minute"; at the next minute the session stops with a clear message and the report is still written from what was said.
- **A database hiccup doesn't end a session**: a failed charge is retried every 5 s; after ~30 s of failures the session stops (so an outage can't give away long sessions).
- **The coach's notes are charged once per session, only after they're written** (`report:<user>:<session id>`; the session id comes from the browser). Not enough credits → 402 before asking Claude, and the report screen still shows the measured numbers. Asking again for the same session is free.
- **Until free credits arrive (#11), a new account has 0 credits.** To test, grant some in the SQL Editor: `select public.grant_credits('<user uuid>', 20, 'Test credits', 'manual:test-1');`

## Limits until accounts exist

- Per address: 2 open sessions, 20 reports an hour; sessions stop at 10 minutes (`.env`). In memory, fine for one server.

## Known gaps

- Not yet run against real Deepgram and Anthropic keys end to end (#1). The UI was checked in Chromium with a fake mic (a synthetic voice) and a simulated `/session` server; the server's routes and session relay are covered by tests with fakes.
- Real packages: `npm ci`, tests, typecheck (with the real React types) and the Vite build pass in CI. `package-lock.json` was generated by CI (2026-11-13) because the cloud workspace has no npm access.
- Cue thresholds are first guesses; tune them on real recordings (several voices, a laptop mic and a headset).

## Declined or deferred

- Server-side coaching engine (planned at first): moved to the browser, see above.
- Accounts, credits, payments: M0b, ported from Offro's patterns.
