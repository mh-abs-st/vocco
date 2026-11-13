// The live coach: takes the words you said (with their times) and short pitch/loudness frames, and decides which
// single cue to show right now. Deterministic rules, no network: instant and free. Also builds the numbers for
// the report at the end.
//
// Times are seconds of audio since the session's audio started (the same clock as Deepgram's word times,
// because the browser streams every sample from the start).

import { CUES, DEFAULT_GOALS } from './cues.js';
import { median, quantile, semitones } from './pitch.js';
import { endsClause, endsSentence, fillerIndexes, countFillers, sentences } from './words.js';

/** @typedef {import('./words.js').Word} Word */
/** @typedef {import('./cues.js').CueKind} CueKind */
/** @typedef {import('./cues.js').Goal} Goal */

export const RULES = {
  startAfterS: 3, // silence after the prompt before "Start now"
  resumeAfterS: 6, // silence mid-speech before "Pick it back up"
  paceWindowS: 12,
  paceMinWords: 10,
  breathWords: 32, // words in a row without a pause of at least `breathGapS`
  breathGapS: 0.3,
  rushGapS: 0.18, // gap after a full stop shorter than this = rushed
  rushWindowS: 25,
  rushCount: 3,
  fillerWindowS: 20,
  fillerCount: 3,
  hesitationGapS: 0.6, // a mid-phrase gap at least this long is a hesitation
  goodPauseMaxS: 2.5,
  monotoneWindowS: 15,
  monotoneMinVoicedS: 4,
  monotoneSpreadSt: 2.0, // pitch spread (p10..p90) under this many semitones = flat
  quietWindowS: 5,
  quietBelowDb: 9, // this far below your normal level = too quiet
  trailDropDb: 8,
  uptalkRiseSt: 2.5,
  showForS: 4, // a cue stays at least this long
  maxShowS: 8, // and at most this long, even if still due
  gapBetweenS: 8, // at least this long between two different cues
  sameKindAgainS: 25, // the same cue doesn't come back sooner
  runOnWords: 35,
  unclearConfidence: 0.55,
};

/**
 * @param {{ goals?: Goal[], targetWpm?: [number, number], baseline?: { speechDb?: number, pitchHz?: number }, rules?: Partial<typeof RULES> }} [opts]
 */
export function createCoach(opts = {}) {
  const R = { ...RULES, ...(opts.rules || {}) };
  const goals = new Set(opts.goals?.length ? opts.goals : DEFAULT_GOALS);
  goals.add('start'); // getting started is always coached
  const [minWpm, maxWpm] = opts.targetWpm || [130, 160];
  const baseline = { ...(opts.baseline || {}) };

  /** @type {Word[]} */
  const words = [];
  /** @type {{ t: number, db: number, hz: number|null }[]} */
  const frames = [];
  let promptEnd = 0; // when you were asked to start
  /** @type {{ from: number, to: number }[]} */
  const breaks = []; // times the connection was lost: not your pauses
  let active = null; // { kind, since }
  let lastShown = -Infinity;
  const lastByKind = new Map();
  const shownCount = {};
  /** @type {{ t: number, kind: string, word?: string, detail?: string }[]} */
  const timeline = [];

  const wordsSince = (t) => words.filter((w) => w.end >= t);
  const framesSince = (t) => frames.filter((f) => f.t >= t);
  const voicedHz = (fs) => fs.filter((f) => f.hz).map((f) => /** @type {number} */ (f.hz));

  function speechDb() {
    if (baseline.speechDb != null) return baseline.speechDb;
    const loud = frames.filter((f) => f.hz).map((f) => f.db);
    return loud.length >= 100 ? median(loud) : null; // after ~2 s of voiced speech
  }

  // ----- each rule: is this cue due at time t? -----
  /** @type {Record<CueKind, (t: number) => boolean>} */
  const due = {
    start: (t) => !words.length && t - promptEnd >= R.startAfterS,
    warmup: () => {
      if (!words.length || words[0].end < promptEnd) return false;
      const firstFew = words.filter((w) => w.start >= promptEnd).slice(0, 3);
      return firstFew.length > 0 && fillerIndexes(firstFew).has(0) && words.length < 8;
    },
    resume: (t) => words.length > 0 && t - Math.max(words[words.length - 1].end, breaks.at(-1)?.to ?? -Infinity) >= R.resumeAfterS,
    slower: (t) => {
      const wpm = paceAt(t);
      return wpm != null && wpm > maxWpm + 15;
    },
    faster: (t) => {
      const wpm = paceAt(t);
      return wpm != null && wpm < minWpm - 25;
    },
    breathe: () => wordsWithoutBreath() >= R.breathWords,
    hold: (t) => {
      const recent = words.filter((w) => w.end >= t - R.rushWindowS);
      let rushed = 0;
      for (let i = 0; i + 1 < recent.length; i++) {
        if (endsSentence(recent[i]) && recent[i + 1].start - recent[i].end < R.rushGapS) rushed++;
      }
      return rushed >= R.rushCount;
    },
    fillers: (t) => countFillers(wordsSince(t - R.fillerWindowS)) >= R.fillerCount,
    monotone: (t) => {
      const hz = voicedHz(framesSince(t - R.monotoneWindowS));
      if (hz.length * 0.02 < R.monotoneMinVoicedS) return false;
      const ref = median(hz);
      const st = hz.map((h) => semitones(h, ref));
      return quantile(st, 0.9) - quantile(st, 0.1) < R.monotoneSpreadSt;
    },
    louder: (t) => {
      const normal = speechDb();
      if (normal == null) return false;
      const recent = framesSince(t - R.quietWindowS).filter((f) => f.hz).map((f) => f.db);
      return recent.length >= 60 && median(recent) < normal - R.quietBelowDb;
    },
    trail: () => lastSentences(3).filter((s) => trailsOff(s)).length >= 2,
    uptalk: () => lastSentences(3).filter((s) => s.at(-1).text.endsWith('.') && risesAtEnd(s)).length >= 2,
  };

  function paceAt(t) {
    if (!words.length) return null;
    const from = Math.max(t - R.paceWindowS, words[0].start);
    const recent = words.filter((w) => w.start >= from && w.end <= t + 0.5);
    const span = t - from;
    if (recent.length < R.paceMinWords || span < 6) return null;
    // Long pauses aren't "slow talking": take them out of the time.
    let paused = 0;
    for (let i = 0; i + 1 < recent.length; i++) paused += Math.max(0, recent[i + 1].start - recent[i].end - 1.0);
    for (const b of breaks) paused += Math.max(0, Math.min(b.to, t) - Math.max(b.from, from)); // outages aren't talking time
    return (recent.length / Math.max(1, span - paused)) * 60;
  }

  function wordsWithoutBreath() {
    let n = 0;
    for (let i = words.length - 1; i > 0; i--) {
      if (words[i].start - words[i - 1].end >= R.breathGapS) return n + 1;
      n++;
    }
    return n + (words.length ? 1 : 0);
  }

  function lastSentences(n) {
    const all = sentences(words).filter((s) => endsSentence(s.at(-1)) && s.length >= 4);
    return all.slice(-n);
  }

  function trailsOff(sentence) {
    const last = sentence.at(-1);
    const end = frames.filter((f) => f.t >= last.end - 0.3 && f.t <= last.end).map((f) => f.db); // voiced or not
    const body = frames.filter((f) => f.t >= sentence[0].start && f.t < last.end - 0.3 && f.hz).map((f) => f.db);
    if (end.length < 5 || body.length < 20) return false;
    return median(body) - median(end) > R.trailDropDb;
  }

  function risesAtEnd(sentence) {
    const last = sentence.at(-1);
    const end = voicedHz(frames.filter((f) => f.t >= Math.max(last.start, last.end - 0.3) && f.t <= last.end));
    const before = voicedHz(frames.filter((f) => f.t >= last.end - 1.5 && f.t < last.end - 0.3));
    if (end.length < 4 || before.length < 10) return false;
    return semitones(median(end), median(before)) > R.uptalkRiseSt;
  }

  // ----- public -----
  return {
    goals: [...goals],
    /** The prompt finished (or the countdown ended): "when to start" is timed from here. */
    promptEnded(t) {
      promptEnd = t;
    },
    /** The connection dropped at `from` and came back at `to`: that gap isn't yours. */
    addBreak(from, to) {
      if (to > from) breaks.push({ from, to });
    },
    /** Final words from speech-to-text. */
    addWords(/** @type {Word[]} */ list) {
      for (const w of list) {
        if (words.length && w.start < words[words.length - 1].start) continue; // repeats
        words.push(w);
      }
    },
    /** One pitch/loudness frame (every ~20 ms). */
    addFrame(/** @type {{ t: number, db: number, hz: number|null }} */ f) {
      frames.push(f);
      if (frames.length > 60 * 50 * 30) frames.splice(0, frames.length - 60 * 50 * 20); // keep the last ~20 min
    },
    /**
     * The cue to show at time t, or null. Call it a few times a second.
     * @returns {{ kind: CueKind, text: string, detail: string } | null}
     */
    tick(t) {
      if (active && t - active.since < R.showForS) return view(active.kind);
      if (active && (t - active.since >= R.maxShowS || !due[active.kind](t))) active = null;
      if (active) return view(active.kind);
      if (t - lastShown < R.gapBetweenS) return null;
      const kinds = /** @type {CueKind[]} */ (Object.keys(CUES))
        .filter((k) => goals.has(CUES[k].goal))
        .filter((k) => t - (lastByKind.get(k) ?? -Infinity) >= R.sameKindAgainS)
        .sort((a, b) => CUES[a].priority - CUES[b].priority);
      for (const k of kinds) {
        if (!due[k](t)) continue;
        active = { kind: k, since: t };
        lastShown = t;
        lastByKind.set(k, t);
        shownCount[k] = (shownCount[k] || 0) + 1;
        timeline.push({ t: round(t), kind: k, word: words.at(-1)?.text });
        return view(k);
      }
      return null;
    },
    /** Words per minute right now (or null before there's enough speech). */
    pace: (t) => paceAt(t),
    words: () => words,
    /** Numbers for the report. */
    summary: () => summarize({ words, frames, promptEnd, timeline, shownCount, R, speechDb: speechDb(), targetWpm: [minWpm, maxWpm], breaks }),
  };
}

const view = (kind) => ({ kind, text: CUES[kind].text, detail: CUES[kind].detail });
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * @typedef {{ t: number, kind: string, word?: string, detail?: string, i?: number }} Flag  `i`: index of the word it points at
 * @typedef {{
 *   spoke: boolean, words: number, durationSec: number, startAt?: number, talkingSec?: number, startDelaySec?: number,
 *   wpm?: number, targetWpm?: number[], paceSeries?: { t: number, wpm: number }[], paceBucketSec?: number,
 *   pauses?: { good: number, hesitations: number, longestSec: number, rushedSentenceEnds: number },
 *   fillers?: { count: number, perMinute: number, words: string[] },
 *   sentences?: { count: number, avgWords: number, runOns: number },
 *   unclearWords?: string[],
 *   voice?: { medianHz: number, rangeSemitones: number, medianDb: number, normalDb: number|null } | null,
 *   connectionLostSec?: number,
 *   cuesShown: Record<string, number>, timeline: Flag[] }} Summary
 */

/**
 * Report numbers from the whole session. Times in `timeline` are seconds of audio; subtract `startAt` for
 * time since you were asked to start. Exported for tests.
 * @returns {Summary}
 */
export function summarize({ words, frames, promptEnd = 0, timeline = [], shownCount = {}, R = RULES, speechDb = null, targetWpm = [130, 160], breaks = [] }) {
  if (!words.length) {
    return { spoke: false, words: 0, durationSec: 0, startAt: round(promptEnd), cuesShown: shownCount, timeline };
  }
  const first = words[0], last = words.at(-1);
  const lost = breaks.reduce((n, b) => n + Math.max(0, Math.min(b.to, last.end) - Math.max(b.from, first.start)), 0);
  const durationSec = Math.max(1, last.end - first.start - lost);
  const brokenBetween = (a, b) => breaks.some((x) => x.from < b.start && x.to > a.end);

  // Pauses: a gap at a clause/sentence end is a pause that helps; a long gap mid-phrase, or one before a filler,
  // is a hesitation.
  const fillers = fillerIndexes(words);
  let goodPauses = 0, hesitations = 0, longest = 0, talking = 0, rushedStops = 0;
  /** @type {{ t: number, kind: string, word?: string, detail?: string }[]} */
  // Cues point at the last word heard when they were shown.
  const lastWordAt = (t) => {
    let k = -1;
    for (let j = 0; j < words.length && words[j].start <= t; j++) k = j;
    return Math.max(0, k);
  };
  const flags = timeline.map((f) => ({ ...f, i: lastWordAt(f.t) }));
  for (let i = 0; i < words.length; i++) {
    talking += words[i].end - words[i].start;
    if (i + 1 >= words.length) break;
    if (brokenBetween(words[i], words[i + 1])) continue; // the connection dropped here: not a pause or hesitation
    const gap = words[i + 1].start - words[i].end;
    longest = Math.max(longest, gap);
    if (endsClause(words[i]) && gap >= R.breathGapS && gap <= R.goodPauseMaxS) goodPauses++;
    else if (!endsClause(words[i]) && (gap >= R.hesitationGapS || (gap >= R.breathGapS && fillers.has(i + 1)))) {
      hesitations++;
      flags.push({ t: round(words[i].end), kind: 'hesitation', word: words[i + 1].text, detail: `${round(gap)} s`, i: i + 1 });
    }
    if (endsSentence(words[i]) && gap < R.rushGapS) rushedStops++;
  }

  // Pace per 10 seconds (per 5 s for talks under 90 s, so a short talk still shows a shape).
  const bucket = durationSec < 90 ? 5 : 10;
  const paceSeries = [];
  for (let t = first.start; t < last.end; t += bucket) {
    const n = words.filter((w) => w.start >= t && w.start < t + bucket).length;
    const outage = breaks.reduce((x, br) => x + Math.max(0, Math.min(br.to, t + bucket) - Math.max(br.from, t)), 0);
    const span = Math.min(bucket, last.end - t) - outage;
    if (span >= bucket * 0.4) paceSeries.push({ t: round(t - first.start, 0), wpm: Math.round((n / span) * 60) });
  }
  const wpm = Math.round((words.length / durationSec) * 60);

  const sents = sentences(words);
  const runOns = sents.filter((s) => s.length > R.runOnWords).length;

  const fillerWords = [];
  for (const i of fillers) fillerWords.push(words[i].word);
  const fillerCount = countFillers(words);
  for (const i of fillers) flags.push({ t: round(words[i].start), kind: 'filler', word: words[i].text, i });

  const unclear = words.filter((w) => w.confidence < R.unclearConfidence && w.word.length > 2 && !fillers.has(words.indexOf(w)));
  for (const w of unclear) flags.push({ t: round(w.start), kind: 'unclear', word: w.text, i: words.indexOf(w) });

  // Voice.
  const voiced = frames.filter((f) => f.hz && f.t >= first.start && f.t <= last.end);
  let voice = null;
  if (voiced.length >= 50) {
    const hz = voiced.map((f) => /** @type {number} */ (f.hz));
    const ref = median(hz);
    const st = hz.map((h) => semitones(h, ref));
    voice = {
      medianHz: Math.round(ref),
      rangeSemitones: round(quantile(st, 0.9) - quantile(st, 0.1)),
      medianDb: round(median(voiced.map((f) => f.db))),
      normalDb: speechDb == null ? null : round(speechDb),
    };
  }

  return {
    spoke: true,
    words: words.length,
    durationSec: round(durationSec),
    startAt: round(promptEnd),
    talkingSec: round(talking),
    startDelaySec: round(Math.max(0, first.start - promptEnd)),
    wpm,
    targetWpm,
    paceSeries,
    paceBucketSec: bucket,
    pauses: { good: goodPauses, hesitations, longestSec: round(longest), rushedSentenceEnds: rushedStops },
    fillers: { count: fillerCount, perMinute: round((fillerCount / durationSec) * 60), words: [...new Set(fillerWords)] },
    sentences: { count: sents.length, avgWords: round(words.length / Math.max(1, sents.length)), runOns },
    unclearWords: unclear.map((w) => w.text.replace(/[^\p{L}'-]/gu, '')).slice(0, 20),
    voice,
    connectionLostSec: lost ? round(lost) : undefined,
    cuesShown: shownCount,
    timeline: flags.sort((a, b) => a.t - b.t).slice(0, 200),
  };
}
