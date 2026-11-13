import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoach, summarize } from '../src/engine.js';
import { countFillers, fillerIndexes, fromDeepgram, sentences } from '../src/words.js';
import { speak, frames, lorem } from './helpers.js';

const all = ['pace', 'pauses', 'fillers', 'voice'];

test('Deepgram words become ours', () => {
  const w = fromDeepgram({ word: 'um', punctuated_word: 'Um,', start: 1.2, end: 1.4, confidence: 0.9 });
  assert.deepEqual(w, { word: 'um', text: 'Um,', start: 1.2, end: 1.4, confidence: 0.9 });
});

test('fillers: single words and two-word phrases', () => {
  const words = speak('Um so I mean the plan is uh kind of simple, you know.');
  assert.equal(countFillers(words), 5); // um, i mean, uh, kind of, you know
  assert.ok(fillerIndexes(words).has(0));
});

test('sentences split on punctuation', () => {
  assert.equal(sentences(speak('One two. Three four? Five')).length, 3);
});

test('"Start now" after 3 seconds of silence, then nothing once you start', () => {
  const c = createCoach();
  c.promptEnded(0);
  assert.equal(c.tick(2), null);
  assert.equal(c.tick(3.1)?.kind, 'start');
  c.addWords(speak('Hello everyone, today I want to talk about habits.', { start: 3.5 }));
  assert.equal(c.tick(6)?.kind, 'start'); // still shown for its minimum time
  assert.equal(c.tick(8), null);
});

test('"Skip the warm-up" when you open with a filler', () => {
  const c = createCoach();
  c.promptEnded(0);
  c.addWords(speak('Um so today', { start: 1 }));
  assert.equal(c.tick(2.5)?.kind, 'warmup');
});

test('"Slow down" when talking well above the target pace', () => {
  const c = createCoach({ goals: ['pace'] });
  c.addWords(speak(lorem(60), { start: 0, wpm: 210, stopGap: 0.05 }));
  const cue = c.tick(16);
  assert.equal(cue?.kind, 'slower');
  assert.ok(c.pace(16) > 180);
});

test('no pace cue at a good pace', () => {
  const c = createCoach({ goals: ['pace'] });
  c.addWords(speak(lorem(40), { start: 0, wpm: 145, stopGap: 0.4 }));
  assert.equal(c.tick(17), null);
});

test('"Pause" after a long stretch without a breath', () => {
  const c = createCoach({ goals: ['pauses'] });
  const words = speak(lorem(40).replace(/\./g, ''), { start: 0, wpm: 150, gap: 0.02 });
  c.addWords(words);
  assert.equal(c.tick(words.at(-1).end)?.kind, 'breathe');
});

test('"Hold the pause" when rushing past full stops', () => {
  const c = createCoach({ goals: ['pauses'] });
  c.addWords(speak('We tried. It failed. We learned. We tried again. It worked.', { start: 0, wpm: 140, stopGap: 0, gap: 0.05 }));
  assert.equal(c.tick(6)?.kind, 'hold');
});

test('"Fewer fillers" after three in 20 seconds', () => {
  const c = createCoach({ goals: ['fillers'] });
  c.addWords(speak('So um the idea is uh simple and um it works.', { start: 0 }));
  assert.equal(c.tick(5)?.kind, 'fillers');
});

test('"Lift your voice" on a flat pitch; not on a varied one', () => {
  const flat = createCoach({ goals: ['voice'] });
  for (const f of frames(0, 16, () => 150 + Math.random())) flat.addFrame(f);
  flat.addWords(speak(lorem(30), { start: 0, wpm: 140 }));
  assert.equal(flat.tick(16)?.kind, 'monotone');

  const lively = createCoach({ goals: ['voice'] });
  for (const f of frames(0, 16, (t) => 150 * 2 ** ((4 * Math.sin(t * 2)) / 12))) lively.addFrame(f);
  lively.addWords(speak(lorem(30), { start: 0, wpm: 140 }));
  assert.equal(lively.tick(16), null);
});

test('"Louder" when well below your normal level', () => {
  const c = createCoach({ goals: ['voice'], baseline: { speechDb: -20 } });
  for (const f of frames(0, 10, (t) => 150 * 2 ** ((4 * Math.sin(t * 2)) / 12), () => -34)) c.addFrame(f);
  c.addWords(speak(lorem(20), { start: 0, wpm: 140 }));
  assert.equal(c.tick(10)?.kind, 'louder');
});

test('only the chosen goals cue live', () => {
  const c = createCoach({ goals: ['voice'] });
  c.addWords(speak('So um the idea is uh simple and um it works.', { start: 0 }));
  assert.equal(c.tick(5), null);
});

test('cues are spaced out: one at a time, the same one not again soon', () => {
  const c = createCoach({ goals: ['fillers'] });
  c.addWords(speak('So um the idea is uh simple and um it works.', { start: 0 }));
  assert.equal(c.tick(5)?.kind, 'fillers');
  c.addWords(speak('Um and uh then um more.', { start: 10 }));
  assert.equal(c.tick(14), null); // fillers was shown at 5: not again within 25 s, and nothing else is due
});

test('summary numbers', () => {
  const words = [
    ...speak('Um, today I want to talk about sleep.', { start: 2, wpm: 150, stopGap: 0.6 }),
    ...speak('It matters more than most people think.', { start: 6.4, wpm: 150, stopGap: 0.6, confidence: 0.4 }),
  ];
  const s = summarize({ words, frames: frames(2, 10), promptEnd: 0 });
  assert.equal(s.spoke, true);
  assert.equal(s.words, 15);
  assert.equal(s.startDelaySec, 2);
  assert.equal(s.fillers.count, 1);
  assert.deepEqual(s.fillers.words, ['um']);
  assert.equal(s.sentences.count, 2);
  assert.ok(s.wpm > 100 && s.wpm < 200, String(s.wpm));
  assert.ok(s.pauses.good >= 1);
  assert.ok(s.unclearWords.includes('matters'));
  assert.ok(s.voice && s.voice.medianHz === 180);
  assert.ok(s.timeline.some((f) => f.kind === 'filler'));
});

test('summary when nothing was said', () => {
  assert.deepEqual(summarize({ words: [], frames: [] }).spoke, false);
});

test('a lost connection is not a hesitation, not talking time, and "Pick it back up" waits after it', () => {
  const before = speak('I think sleep is the most underrated', { start: 0, wpm: 150 });
  const after = speak('habit we have, and here is why.', { start: 40, wpm: 150 });
  const c = createCoach({ goals: ['pace'] });
  c.addWords(before);
  c.addBreak(before.at(-1).end + 0.2, 39.5);
  c.addWords(after);
  const s = c.summary();
  assert.equal(s.pauses.hesitations, 0);
  assert.ok(s.durationSec < 7, String(s.durationSec)); // ~6 s of talking, not 42
  assert.ok(s.wpm > 120, String(s.wpm));
  assert.ok(s.connectionLostSec > 30);
  assert.ok(s.paceSeries.every((p) => p.wpm > 0)); // no zero-pace points for the outage

  const r = createCoach();
  r.addWords(before);
  r.addBreak(3, 30);
  assert.equal(r.tick(33), null); // only 3 s since the connection came back
  assert.equal(r.tick(36.5)?.kind, 'resume');
});

test('short talks get 5-second pace points, long ones 10', () => {
  const short = summarize({ words: speak(lorem(120), { start: 0, wpm: 150, stopGap: 0.3 }), frames: [] });
  assert.equal(short.paceBucketSec, 5);
  assert.ok(short.paceSeries.length >= 9, String(short.paceSeries.length)); // ~50 s → ~10 points
  const long = summarize({ words: speak(lorem(300), { start: 0, wpm: 150, stopGap: 0.3 }), frames: [] });
  assert.equal(long.paceBucketSec, 10);
});

test('timeline flags point at their word', () => {
  const words = [...speak('Um, today I want to', { start: 0 }), ...speak('talk about sleep.', { start: 3 })];
  const c = createCoach({ goals: ['fillers'] });
  c.promptEnded(0);
  c.addWords(words);
  c.tick(5); // shows a cue at t=5
  const s = c.summary();
  const hes = s.timeline.find((f) => f.kind === 'hesitation');
  assert.equal(words[hes.i].text, 'talk');
  const fil = s.timeline.find((f) => f.kind === 'filler');
  assert.equal(words[fil.i].text, 'Um,');
  for (const f of s.timeline) assert.ok(Number.isInteger(f.i) && f.i >= 0 && f.i < words.length, JSON.stringify(f));
});
