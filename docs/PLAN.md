# Vocco — Product & Build Plan

React + Node.js web app. Started 2026-11-12. This is the **living** plan: what's built, what's next. The original product
plan it came from (the owner's Claude doc "Vocco — Product & Build Plan") is kept as it was in
[product-plan.md](product-plan.md). Work is tracked in GitHub issues #1–#35, one milestone per row of section 9.

## 1. The idea

A web app where you pick a **topic** and a **partner** (a coach, a debate opponent, or a tough audience), then speak out loud.
While you talk, the app listens and gives small, timed cues — *start now*, *pause here*, *slow down*, *lift your voice*,
*land the sentence*, *that word was unclear*. When you finish, you get a report with a timeline of your speech, scores,
the exact words and moments to fix, and short drills.

**Name:** Vocco (from *voce*, voice). Website title: *Vocco — Practice speaking out loud, with a coach that listens*.
Home headline: **Practice out loud. Get coached while you speak.** Still to check: domain (.com / .app / .ai) and a trademark search.

**Separate repo, separate project.** Nothing is shared with Offro at runtime: its own Supabase project (when added),
accounts, credits, payments, domain and deploys. Offro (`mh-abs-st/offro`) is only a reference for the listening side;
code taken from it is copied and adapted, never imported.

## 2. What we borrow from Offro (reference only)

| Offro file | Pattern | In Vocco |
|---|---|---|
| `backend/deepgram.js` | Nova-3 stream setup, `filler_words`, `mip_opt_out`, usage logging | `apps/server/src/deepgram.js` (raw 16 kHz PCM, word timings) |
| `extension/capture-core.js` (`MIC_AUDIO`) | One raw mic setting everywhere | `apps/web/src/audio/mic.ts` + `public/capture-worklet.js` |
| `extension/talkcoach.js` | Answer timer, gaps end a stretch of speech | `packages/shared/src/engine.js` |
| `backend/mock.js` | Structure / Specifics / Relevance / Delivery scoring with measured stats | `apps/server/src/report.js` |
| `backend/aierrors.js`, `practice.js` (`callTool`) | Thinking defaults, strict forced tool with fallback | `apps/server/src/anthropic.js` |
| `entitlements.js`, `plans.js`, `billing.js`, `paddle.js`, `trial.js`, `guard.js` | Credits, free tier, Paddle, one trial per person, abuse limits | Later (M0b); `guard.js` started |
| `costs.js`, `experiments.js`, `funnels.js` | Cost tracking, A/B tests, funnels | Later |
| `mirror.js` | WebRTC phone view + coach Listen | Later: a human coach listening in |

## 3. Modes

1. **Coach (talk on a topic)** — built in v0.1. Speak for 1–5 minutes; live cues; a report at the end.
2. **Opponent (debate)** — the partner takes the other side with timed turns (opening → rebuttal → cross-questions → closing), out loud. Formats: quick argument, Lincoln–Douglas-lite, parliamentary-lite. Strictness: friendly / firm / ruthless.
3. **Audience Q&A** — give a talk; 1–3 personas ask follow-ups.
4. **Drills** — read-aloud scripts with pause marks, pace ladders, pitch warm-ups, filler-free answers, impromptu topics.

Topics: a library by category (built: 54 topics in 7 categories), your own topic, or (later) paste your own speech.

## 4. What gets coached, and how it's measured

| Skill | Signal | Source | Live cue | Report | Status |
|---|---|---|---|---|---|
| When to start | Silence after the prompt; filled starts | First word time | Start now · Skip the warm-up · Pick it back up | Start delay | Built |
| Pauses | Gaps at clause ends (good) vs mid-phrase (hesitation); long runs without a breath; rushing past full stops | Deepgram word times + punctuation | Pause · Hold the pause | Pause counts, hesitations | Built |
| Pace | Words/min over a rolling 12 s window, long pauses removed | Word times | Slow down · A bit faster | Pace over time | Built |
| Voice up/down (pitch) | Pitch spread in semitones (flat = monotone); rise at the end of statements (uptalk) | YIN pitch in the browser | Lift your voice · Land it down | Voice range | Built |
| Voice up/down (volume) | Below your normal level; drop at sentence ends | Loudness in the browser, mic-check baseline | Louder · Don't trail off | — | Built |
| Fillers | um, uh, you know, I mean, basically… | Nova-3 `filler_words` + word list | Fewer fillers | Count, per minute, which | Built |
| Spoken punctuation | Sentence length, run-ons | Transcript punctuation | — | Avg words per sentence, very long ones | Built |
| Pronunciation | Accuracy per word and phoneme, fluency, prosody | Azure Pronunciation Assessment (M3). Now: low Deepgram word confidence as a weak "not clear" hint | — | Words to practise | Hint only |
| Accent (clarity) | Phoneme errors vs target accent | Azure (M3) | — | Sounds to work on (framed as clarity) | M3 |
| Content | Structure, claim, evidence, relevance | Claude, after the session | — | Scores, stronger version, drills | Built |

**Live cue rules:** one cue at a time, shown 4–8 s, at least 8 s between cues, the same cue not again within 25 s,
priority *start → pace → pauses → fillers → voice*, only the session's chosen goals cue live (getting started always does).
Deterministic rules in the browser: instant and free. Thresholds are in `RULES` in `packages/shared/src/engine.js`.

## 5. Architecture (as built)

```
Browser (React)                                   Server (Node, apps/server)            Vendors
mic → AudioWorklet (16 kHz) ─┬─ pitch + loudness every 20 ms → coach engine (shared)
                             └─ 16-bit PCM ──── WebSocket /session ──── relay ──────────→ Deepgram Nova-3
coach engine ← words + timings ←──────────────── words ←──────────────────────────────── (word timings, fillers)
end → summary + transcript ──── POST /api/report ─── Claude (strict tool) ────────────→ Anthropic
```

- `packages/shared` — plain JS (ESM + JSDoc types) used by both sides: cue engine, pitch (YIN) and loudness, words/fillers, topics, socket protocol.
- `apps/server` — Node ≥ 22, `node:http` + `ws`; relays audio to Deepgram (Node's built-in WebSocket, key as subprotocol), writes reports with Claude over `fetch`, serves the built web app. In-memory limits per address until accounts exist.
- `apps/web` — React 19 + Vite + TypeScript. History and settings in `localStorage` only.

Opponent mode (M4) adds: Claude writing replies on turn end (Sonnet, thinking off; a short Haiku starter first), Deepgram Aura-2 TTS streamed back, turn timer, barge-in in cross-questions, echo cancellation on in modes where the partner speaks (headphones recommended).

## 6. Data model (Supabase, M0b)

`accounts`, `credit_ledger`, `trials`, `api_costs`, `topics` (custom), `personas`, `sessions`, `session_metrics`,
`session_flags`, `drills`, `drill_attempts`, `recordings` (opt-in, 30-day expiry). Until then nothing is stored on the server.

## 7. Screens

Built: Home (modes, your sessions), Topic picker (categories, surprise me, your own topic), Setup (side, length,
time to think, live goals, language, mic + mic check), Live session (cue banner, transcript with fillers and unclear
words marked, pace, pitch line + loudness), Report (stats, pace chart, coach's notes, stronger version, drills,
transcript, cues you got).
Later: landing page, sign-in, progress, account / buy credits.

## 8. Pricing & cost (first guess; measure with `LOG_USAGE=1`)

Deepgram Nova-3 streaming ≈ $0.0077/min list. A report (Sonnet 5.5) ≈ 1–2k tokens in, ~1k out. Aura-2 voice (M4)
≈ $0.030 per 1k characters ≈ $0.02–0.03 per minute the partner speaks. Credit model like Offro: 1 credit per live minute,
report 2–3 credits, free credits once.

## 9. Milestones

| # | Scope | Status |
|---|---|---|
| v0.1 tune | Run with real keys, lockfile + `npm ci`, tune cues, robustness, browsers (#1–#7) | In progress: lockfile + CI (#1), reconnect (#3), browser support code + phone layout (#4), report polish (#5) done; real-key run (#1) and tuning (#2) need the owner |
| M0 | Monorepo, CI, server, shared core, tests | **Done (v0.1)** |
| M0b | Supabase auth, accounts, credits, trial, cost tracking (ported patterns) | Next |
| M1 | Coach mode: mic, Deepgram relay, live start/pace/pause/filler cues, topics, report | **Done (v0.1)** — needs real-mic tuning |
| M2 | Voice: pitch + loudness, calibration, monotone/uptalk/trailing-off/quiet cues, charts | **Mostly done (v0.1)** — tune thresholds on real voices |
| M3 | Pronunciation: Azure streaming assessment, word highlighting, words to practise with model audio, read-aloud drills | |
| M4 | Opponent mode: debate formats, turn timer, Claude opponent, Aura-2 TTS, barge-in | |
| M5 | Audience Q&A, progress page, Paddle checkout, landing page, A/B + funnels, private beta | |

## 10. Open decisions

1. ~~Separate product or part of Offro?~~ **Decided 2026-11-12: fully separate.**
2. Languages at launch: recommend English only (Azure prosody and content scores are en-US only).
3. Azure as a second vendor for pronunciation (recommended) vs Deepgram confidence only.
4. Partner voice: Deepgram Aura-2 (simple) vs ElevenLabs (more expressive, pricier).
5. Recordings for replay: off by default, opt-in with 30-day expiry?
6. Main audience: students/debaters, job seekers, non-native professionals, or public speakers?
7. Human coaches listening in (WebRTC) — later or never?
8. Domain and hosting (Hostinger like Offro, or Render/Fly for WebSockets).
