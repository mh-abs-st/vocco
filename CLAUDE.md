# Vocco

Web app for practising speaking out loud: pick a topic, talk, get live cues (start, pace, pauses, fillers, voice up/down)
and a report at the end. React + Node.js.
**Read `docs/DECISIONS.md` first** (why things are the way they are), and `docs/PLAN.md` for the plan and milestones.
Update DECISIONS.md when a decision changes, and PLAN.md's milestone table when one moves.

Vocco is its own product. The Offro repo (`mh-abs-st/offro`) is only a reference for similar code (Deepgram, mic capture,
credits, payments): copy and adapt, never import from it or share its accounts/data.

## Layout (npm workspaces)
- `packages/shared/` — plain JS (ESM) with JSDoc types, no build step; used by the server and the web app.
  - `engine.js`: the live coach (`createCoach`: words + pitch/loudness frames → one cue at a time; `summarize` → report numbers). Thresholds in `RULES`.
  - `cues.js` (cue copy, goals), `pitch.js` (YIN pitch, loudness, PCM), `words.js` (Deepgram words, fillers, sentences), `topics.js` (topic library), `protocol.js` (the `/session` messages).
- `apps/server/` — Node ≥ 22, `node:http` + `ws`, ESM.
  - `supabase.js` (accounts, credits, trial claims, cost rows over REST; optional: off without `SUPABASE_URL`), `plans.js` (prices and credit costs, one place), `credits.js` (check and charge: live minutes, reports), `trial.js` (free credits once per browser / email / network, keyed hashes only), `costs.js` (prices, cost rows in batches, the usage summary), `admin.js` (`/admin/usage`: local only + `ADMIN_TOKEN`),
  - `index.js` (start-up, `/session` WebSocket), `app.js` (routes: `/health`, `/api/config`, `/api/me`, `/api/account` (DELETE), `/api/topics`, `/api/report`, the built web app), `session.js` (browser audio → Deepgram, words back), `deepgram.js`, `report.js` (Claude report: prompt, strict tool, clean-up), `anthropic.js` (fetch client, thinking defaults, `callTool`), `guard.js` (limits per address, origin check), `config.js` (env).
- `apps/web/` — React 19 + Vite + TypeScript.
  - `src/screens/`: `Home`, `TopicPicker`, `Setup` (+ mic check), `Session` (live), `Report`, `SignIn` (email link, Google), `Account` (sign out, delete).
  - `src/audio/mic.ts` + `public/capture-worklet.js`: mic → 16 kHz → pitch/loudness frames + PCM.
  - `src/lib/`: `auth.ts` (Supabase Auth over REST, balance, welcome; off when the server has no accounts), `browser-id.ts` (random id for the free-credit check), `next.ts` (where to go after signing in), `session-socket.ts`, `api.ts`, `history.ts` (localStorage), `types.ts`, `format.ts`.
- `db/`: `schema.sql` (Supabase: run in the SQL Editor, safe to re-run), `test/` (applies it twice on plain Postgres and checks credits and access: `DATABASE_URL=… db/test/run.sh`).
- `docs/`: `PLAN.md` (living plan, milestones), `SUPABASE.md` (project setup), `DECISIONS.md`, `product-plan.md` (the original product plan, kept as it was), `screenshots/`.
- Work is tracked in GitHub issues, grouped by milestone; decisions for the owner have the `decision` label.

## Run
- `npm install` at the root (workspaces link `@vocco/shared`).
- `cp apps/server/.env.example apps/server/.env` and add `DEEPGRAM_API_KEY` and `ANTHROPIC_API_KEY`.
- `npm run dev` → server on :8787, web on http://localhost:5173 (Vite proxies `/api`, `/health`, `/session`).
- Production: `npm run build` then `npm start` (the server serves `apps/web/dist`). Set `ALLOWED_ORIGINS` and, behind a proxy, `TRUST_PROXY=1`.

## Test
- `npm test` (node:test, no network: Deepgram, Claude and Supabase are faked). Schema changes: `db/test/run.sh` against a throwaway Postgres (CI runs it too); add a check to `db/test/checks.sql`. Keep it green; add a test with every change to `packages/shared` or `apps/server`.
- `npm run typecheck` for the web app.
- UI changes: check in a browser, or with Playwright and Chromium's fake mic (`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=voice.wav`) plus `page.routeWebSocket('**/session', …)` to simulate the server.

## Conventions
- Models: `REPORT_MODEL` (default `claude-sonnet-5-5`, thinking off by default in `anthropic.js`); `claude-haiku-5-5` at low effort for quick lines later.
- Privacy: nothing about a session is stored on the server; history lives in the browser. Deepgram `mip_opt_out` stays on.
- User-facing copy: plain, short, says what to do next. Errors are sentences a person can act on ("Allow the mic in the address bar, then try again").
- Coaching cues: one at a time, few words, an action ("Slow down", "Pause"), never a judgement.
- Accessibility: text colours at least 4.5:1 (see DECISIONS.md → Accessibility), real buttons with visible focus, `aria-pressed` on choice chips, announce live changes through the hidden status line in `Session.tsx` (not by making busy elements live regions).
- Credits (when Supabase is set up): live minutes are charged in `session.js` (`payForMinutes`), reports in `app.js` after they're written; every change goes through `spend_credits` / `grant_credits` with a `ref`. New paid features: a cost in `plans.js`, charge only on success.
- Costs: a new vendor or model call records a row through the cost recorder (`costs.record`), with its price in `costs.js`.
- Never commit `.env` or keys.
