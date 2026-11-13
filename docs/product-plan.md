# Vocco — Product & Build Plan (original)

> The product and business plan Vocco started from, written 2026-11-12, kept as it was (exported from the owner's Claude doc
> "Vocco — Product & Build Plan"). It's the reference for **why** and **what**.
> For what's built and what's next, see [PLAN.md](PLAN.md) (status, milestones) and the GitHub issues; for decisions that
> changed since, see [DECISIONS.md](DECISIONS.md). Known differences from what was built:
> - The live coach runs in the browser, not on the server (DECISIONS.md → Coaching).
> - The server uses `node:http` + `ws` instead of Express; the web app uses plain React state instead of React Router, TanStack Query and Zustand.
> - The mic check is 6 seconds, not 20.
> - 54 topics were seeded, not ~60.

React + Node.js web app, built on what already works in Offro.

## 1. The idea in one paragraph

A web app where you pick a **topic** and an **AI partner** (a coach, a debate opponent, or a tough audience), then speak out loud. While you talk, the app listens and gives small, timed cues — *start now*, *pause here*, *slow down*, *lift your voice*, *land the sentence*, *that word was unclear*. When you finish, you get a report with a timeline of your speech, scores, the exact words and moments to fix, and short drills. It's a separate product in its own repo; Offro is only a reference for how the listening side works (mic capture, live speech-to-text, speaking timer, delivery stats). New on top of that are two signals: **voice pitch/volume** and **pronunciation scoring**.

**Name: Vocco** (from *voce*, voice; chosen 12 Nov). Website title: *Vocco — Practice speaking out loud, with a coach that listens*. Home headline: **Practice out loud. Get coached while you speak.** Still to check: domain (.com / .app / .ai) and a trademark search.

## 2. What we borrow from Offro (reference only)

**Separate repo, separate project.** Nothing is shared at runtime: its own Supabase project, accounts, credits, payments, domain and deploys. The files below are where to look for a working pattern; code is copied and adapted into the new repo, never imported from Offro.

| Offro file | What it gives us | How it carries over |
| --- | --- | --- |
| `backend/deepgram.js` | Nova-3 / Flux stream setup, `filler_words`, keyterms, `mip_opt_out`, usage logging | Copy almost as is. Coaching streams use **Nova-3** (Flux has no filler words). Add `words` timing use (start/end/confidence per word). |
| `extension/capture-core.js` (`MIC_AUDIO`) | One mic setting everywhere, mic → backend WebSocket | Becomes a React hook `useMicStream()`, but sends 16 kHz PCM from an AudioWorklet (needed for pitch analysis and for Azure). |
| `extension/talkcoach.js` | Answer timer, gap detection (`GAP_MS`), "Start landing it / Wrap up" levels | Basis of the live **pacing & turn timer** engine; move it into a shared package so web and server can both use it. |
| `backend/mock.js` | Scoring Structure / Specifics / Relevance / **Delivery**, delivery stats (length, pace, fillers) | Basis of the **report** prompt and score rubric. |
| `backend/streaming.js`, `aierrors.js`, `hint.js` | Streamed Claude answers, thinking defaults, refusal fallback, fast quick lines on Haiku | Opponent replies (Sonnet, no thinking) and quick cues/rebuttal starters (Haiku, effort low). |
| `entitlements.js`, `plans.js`, `billing.js`, `paddle.js`, `trial.js`, `guard.js` | Credits, per-minute metering, free tier, Paddle checkout, one trial per person, abuse limits | Port as a package. Same model: **1 credit = 1 live minute**, fixed costs for reports/drills. |
| `costs.js` | Cost per request / per stream, `/admin/usage` | Port, add Azure and TTS lines. |
| `experiments.js`, `funnels.js`, `admin-page.js` | A/B tests, funnels, local-only admin | Port unchanged. |
| `mirror.js` | WebRTC phone view + coach Listen | Later: a **human coach** can listen in and send notes during a session. |
| `messages.js`, copy rules in CLAUDE.md | Plain, short, user-facing copy; never say "AI"/"model" | Keep the same rules. |
| `db/schema.sql` | Re-runnable Supabase schema | Same pattern, new tables (below). |

Not carried over: everything extension-specific (side panel, offscreen document, overlay card, tab capture, Solve, job tracker).

## 3. Modes

1. **Coach (trainer).** You speak on a topic for a set time (1–5 min). The coach stays quiet and shows live cues; at the end it gives spoken + written feedback and asks you to redo the weakest 30 seconds.
2. **Opponent (debate).** The AI takes the other side. Timed turns: opening → rebuttal → cross-questions → closing. It answers out loud, pushes on weak points and interrupts only in cross-questions. Formats: *Quick argument* (2×1 min), *Lincoln–Douglas-lite*, *Parliamentary-lite*. Strictness: friendly / firm / ruthless.
3. **Audience Q&A.** You give a talk; a panel of 1–3 personas (skeptical investor, confused beginner, hostile journalist) asks follow-ups.
4. **Drills.** Short focused exercises: read-aloud scripts with pause marks (scripted pronunciation), pace ladders (read at 120 → 150 → 180 wpm), pitch range warm-ups, filler-free 30-second answers, impromptu topics with a 30-second prep timer.

**Topics:** a library by category (everyday, business, school debate motions, interviews, toasts/speeches, pitches), a custom topic, or paste/upload your own speech or script. **Setup** per session: mode, topic, side (for/against/random), length, persona voice, target accent (US / UK / neutral), and up to two goals to focus on (e.g. *pace + fillers*).

## 4. What gets coached, and how it's measured

| Skill | Signal | Where it comes from | Live cue | In the report |
| --- | --- | --- | --- | --- |
| **When to start** | Time from the end of the prompt (or opponent's turn) to your first real word; filled starts ("um, so…") | Turn end event + first word timestamp | "Start now" after 3 s of silence; "Skip the warm-up" on filled starts | Start delay per turn |
| **When to pause** | Gaps between words; is the gap at a sentence/clause boundary (good) or mid-phrase (hesitation)? Too few pauses in long sentences | Deepgram word start/end times + punctuation from `punctuate`/`smart_format` | "Pause" when you run 25+ words without a breath; "Hold the pause" when you rush past a full stop | Pause map: good pauses vs hesitations |
| **Pace** | Words per minute over a rolling 10 s window; target band set by mode (default 130–160 wpm) | Word timestamps | "Slow down" / "A bit faster" with a small pace meter | Pace line over time |
| **Up / down (pitch)** | Pitch range in semitones, monotone stretches, rising tone at the end of statements (uptalk), falling-off at sentence ends | Client-side pitch tracking (YIN in an AudioWorklet), compared to your own baseline from the mic check | "Lift your voice" on 15 s of monotone; "Land it down" on uptalk | Pitch contour with markers |
| **Up / down (volume, energy)** | Loudness in dB, trailing off at sentence ends, emphasis on key words | Client-side RMS loudness | "Louder" / "Don't trail off" | Energy line, emphasis hits |
| **Pronunciation** | Accuracy per word and per phoneme, fluency, prosody (stress, intonation, rhythm) | Azure AI Speech **Pronunciation Assessment**, unscripted mode (scripted mode in read-aloud drills) | Unclear word shown in the transcript (no interruption) | Word list to practise, with model audio from TTS |
| **Accent** | Phoneme errors that hurt clarity for the chosen target accent | Same as pronunciation + target locale (en-US / en-GB) | — | "Sounds to work on" with drills. Framed as **clarity**, never as getting rid of an accent |
| **Spoken punctuation** | Does your voice mark sentence ends (pause + falling pitch)? Run-on sentences, sentence length | Transcript punctuation + pause + pitch at boundaries | — | Run-on count, avg sentence length |
| **Fillers** | um, uh, like, you know, so | Nova-3 `filler_words` + a word list | Count chip; nudge on 3 in 20 s | Fillers per minute |
| **Content** | Structure, clear claim, evidence, answering the actual point (rebuttal relevance) | Claude, after each turn and at the end | — | Scores + a stronger version of your weakest part |

**Live cue rules** (so it helps instead of distracting): one cue on screen at a time, at most one new cue every ~8 s, priority order *start → pace → pause → pitch/volume → fillers*, only the session's chosen goals cue live by default, everything else goes to the report. Cues are computed by a **deterministic rules engine** (no Claude call), so they're instant and free.

Calibration: a 20-second mic check at the start (read a sentence) records your noise floor, normal loudness and pitch range, so "monotone" and "too quiet" are relative to *your* voice.

## 5. Architecture

**Monorepo** (npm workspaces):

- `apps/web` — React 19 + Vite + TypeScript, React Router, TanStack Query (server data), Zustand (live session state), CSS Modules or Tailwind (pick one), Recharts or a small canvas for live meters.
- `apps/server` — Node ≥ 20, Express + `ws`, ESM, same style as Offro's backend; `node:test` with fetch fakes.
- `packages/shared` — types for socket messages, cue definitions, scoring rubric, the talk/pace timer.
- `db/schema.sql` — Supabase (auth, accounts, credits ledger, sessions, scores), re-runnable like Offro's.

**Live pipeline (one session):**

1. Browser: mic → AudioWorklet → (a) pitch + loudness frames every 20 ms, computed locally; (b) 16 kHz PCM chunks → WebSocket `/session`.
2. Server fans the audio out to **Deepgram Nova-3** (transcript, word timings, fillers) and, when the session uses it, **Azure Pronunciation Assessment** (streaming, unscripted).
3. Server **coach engine** merges word timings + client pitch/loudness frames + pronunciation results → emits `cue`, `metric` and `word_flag` events back over the socket.
4. Opponent / audience turns: on turn end → Claude (Sonnet 5.5, thinking off, streamed) writes the reply → streamed to **TTS** → audio chunks to the browser. While the AI speaks, the mic is ducked; if you start talking during cross-questions, TTS stops (barge-in).
5. On session end → Claude writes the report from the transcript + metrics (never from audio).

**Turn-taking:** timed debate turns make this easy — a visible turn timer plus an "I'm done" button, with Deepgram's `utterance_end` as a backup. Flux-style end-of-turn detection is only needed for free conversation later.

**Latency target for the opponent:** under ~2 s from your last word to its first word (end of turn ~0.5–1.2 s, first Claude tokens ~0.5–1 s, TTS first audio ~0.1–0.3 s). A short Haiku "starter" line (like Offro's quick start) can be spoken first while Sonnet writes the full reply.

**Echo:** the AI's voice coming out of laptop speakers will leak into the mic. Recommend headphones in setup; turn on Chrome's echo cancellation **only** in modes where the AI speaks (Offro's raw-mic decision stays for coach-only mode, where accuracy matters most).

**Vendors:**

- Speech-to-text: Deepgram Nova-3 (already integrated, `mip_opt_out` on).
- Pronunciation: Azure AI Speech Pronunciation Assessment — supports unscripted streaming, scores accuracy, fluency and prosody, and costs the same as standard speech-to-text. Caveat: its prosody and content scores are **en-US only**, so pitch/intonation coaching for other locales comes from our own pitch tracking.
- Voice for the AI: Deepgram Aura-2 (same vendor and WebSocket style, $0.030 per 1k characters ≈ $0.02–0.03 per spoken minute, English + 6 other languages). Alternative if voices need more character: ElevenLabs.
- Text: Claude Sonnet 5.5 for opponent/report, Haiku 5.5 for quick lines and cue wording.

**Privacy (same stance as Offro):** audio is streamed, not stored, by default; transcripts and reports are stored only in the user's account and can be deleted. Optional "Save recordings for replay" (Supabase Storage, auto-deleted after 30 days). Deepgram opt-out on; no training on user audio.

## 6. Data model (Supabase)

- `accounts`, `credit_ledger`, `trials`, `experiments`, `api_costs` — ported from Offro.
- `topics` (id, category, title, motion, difficulty, language, is_public, owner_id)
- `personas` (id, role: coach/opponent/audience, name, voice_id, strictness, system_prompt)
- `sessions` (id, user_id, mode, topic_id, persona_id, settings jsonb, started_at, ended_at, credits_used)
- `session_turns` (session_id, idx, speaker, text, started_ms, ended_ms)
- `session_metrics` (session_id, wpm_avg, pause_stats jsonb, pitch_stats jsonb, fillers_per_min, pron_scores jsonb, content_scores jsonb)
- `session_flags` (session_id, t_ms, kind, word, detail) — the report timeline
- `drills` + `drill_attempts` — practice items generated from weak spots
- `recordings` (optional, with expiry)

## 7. Screens

1. **Landing** — what it does, a 30-second demo, pricing.
2. **Sign in** — Supabase (Google + email), welcome credits via the ported trial check.
3. **Home** — pick a mode; recent sessions; current focus goals; streak.
4. **Topic picker** — categories, search, "surprise me", custom topic, paste your own script.
5. **Session setup** — persona, side, length, target accent, goals; mic check + calibration.
6. **Live session** — big transcript in the middle; one cue at a time above it; pace meter, pitch line and loudness bar; turn timer; opponent avatar with a speaking waveform; *Pause*, *I'm done*, *End*.
7. **Report** — overall + per-skill scores, timeline with markers (tap a marker to see/hear the moment), words to practise, "stronger version" of your weakest part, *Redo this part*, suggested drills.
8. **Progress** — trends per skill over sessions.
9. **Settings / Account / Buy credits** — ported flows.

## 8. Pricing & cost (first guess, to measure with `costs.js`)

- Per live minute: Deepgram ≈ $0.005–0.008, Azure pronunciation ≈ standard STT rate, Aura-2 voice ≈ $0.02–0.03 per minute the AI speaks, Claude a few cents per opponent turn. Roughly **$0.03–0.06 per minute** in debate mode, much less in coach-only mode.
- Same credit model as Offro: 1 credit per live minute, report 2–3 credits, drill pack 2 credits; free tier 30 credits once, sessions capped for free accounts.

## 9. Milestones

| # | Scope | Rough time |
| --- | --- | --- |
| M0 | Repo scaffold (workspaces, Vite, Express, CI, lint, tests), Supabase schema, auth, credits/trial/guard ported, deploy pipeline | 1 week |
| M1 | **Coach mode v1**: mic hook, Deepgram stream, word-timing engine, live pace / pause / filler / start cues, topic library, Claude report | 2 weeks |
| M2 | **Voice up/down**: AudioWorklet pitch + loudness, mic calibration, monotone / uptalk / trailing-off cues, pitch & energy charts | 1 week |
| M3 | **Pronunciation**: Azure streaming assessment, word highlighting, "words to practise" with TTS model audio, read-aloud drills | 1 week |
| M4 | **Opponent mode**: debate formats, turn timer, Claude opponent prompts per strictness, Aura-2 TTS streaming, barge-in, echo handling | 2 weeks |
| M5 | Audience Q&A, progress page, Paddle checkout, landing page, A/B + funnels, private beta | 1–2 weeks |

About 8–9 weeks to a beta at Offro's pace. M1 alone is already a usable product.

## 10. Open decisions

1. **Separate product or part of Offro?** Decided (12 Nov): fully separate repo and project, with its own accounts, credits and data. Offro is only a reference for the listening pipeline.
2. **Languages at launch.** Recommend English only (pronunciation prosody and content scores are en-US only); add others with our own pitch tracking later. → issue #30
3. **Second vendor (Azure) for pronunciation** — worth it for real phoneme-level feedback; the fallback (Deepgram word confidence) is a weak signal. → #31
4. **AI voice:** Deepgram Aura-2 (simple, one vendor) vs ElevenLabs (more expressive, pricier). → #32
5. **Recordings for replay:** off by default, opt-in with 30-day expiry? → #33
6. **Audience:** students/debaters, job seekers (cross-sell from Offro), non-native professionals, or public speakers? This changes the topic library and tone. → #34
7. **Human coaches** listening in via the ported WebRTC (`mirror.js`) — later, or never? → #35

## 11. First tasks once the private repo exists

1. Scaffold the monorepo, CI (tests on push, like Offro's workflows), `.env.example`, CLAUDE.md and `docs/DECISIONS.md` in the same style.
2. Port `deepgram.js`, `supabase.js`, `entitlements.js`, `plans.js`, `trial.js`, `guard.js`, `costs.js` with their tests.
3. Build `useMicStream()` + the AudioWorklet (PCM out, pitch + loudness frames) and a mic-check page.
4. `/session` WebSocket with the word-timing coach engine and the first three cues (start, pace, pause).
5. Topic library seed (~60 topics across categories) and the coach-mode report prompt adapted from `mock.js`.

## Sources

- [Azure: Use pronunciation assessment](https://learn.microsoft.com/da-dk/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Azure: pronunciation assessment pricing note](https://learn.microsoft.com/en-ca/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Azure: prosody/content only en-US (Q&A)](https://learn.microsoft.com/en-sg/answers/questions/1822620/azure-prononciation-assessment)
- [Deepgram Aura-2 TTS pricing](https://www.layer3labs.io/guides/deepgram-flux-tts-pricing)
- [Deepgram speech models and languages](https://www.developersdigest.tech/models/speech/deepgram)
- Offro repo: `CLAUDE.md`, `docs/DECISIONS.md`, `backend/deepgram.js`, `extension/talkcoach.js`, `backend/mock.js`
