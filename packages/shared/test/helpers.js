// Build fake Deepgram-style words and pitch frames for tests.

/**
 * Words from a sentence, spoken at `wpm`, starting at `start`. A gap of `stopGap` follows each full stop.
 * @returns {import('../src/words.js').Word[]}
 */
export function speak(text, { start = 0, wpm = 140, stopGap = 0.5, gap = 0.05, confidence = 0.95 } = {}) {
  const per = 60 / wpm; // seconds per word, including the small gap
  let t = start;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      const w = { word: raw.toLowerCase().replace(/[^a-z']/g, ''), text: raw, start: t, end: t + per - gap, confidence };
      t += per + (/[.!?]$/.test(raw) ? stopGap : 0);
      return w;
    });
}

/** Pitch frames every 20 ms from `from` to `to`, with pitch from `hzAt(t)` and loudness from `dbAt(t)`. */
export function frames(from, to, hzAt = () => 180, dbAt = () => -25) {
  const out = [];
  for (let t = from; t < to; t += 0.02) out.push({ t, hz: hzAt(t), db: dbAt(t) });
  return out;
}

export const lorem = (n) =>
  Array.from({ length: n }, (_, i) => (i % 12 === 11 ? 'point.' : ['we', 'should', 'build', 'better', 'tools', 'for', 'people', 'who', 'speak', 'every', 'day'][i % 11])).join(' ');
