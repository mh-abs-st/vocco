import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yinPitch, rmsDb, analyzeFrame, FRAME, SAMPLE_RATE, floatToInt16, quantile, semitones } from '../src/pitch.js';

const sine = (hz, amp = 0.3, n = FRAME) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE));
// A voice-like tone: fundamental plus weaker harmonics.
const voice = (hz) => Float32Array.from({ length: FRAME }, (_, i) => {
  const x = (2 * Math.PI * hz * i) / SAMPLE_RATE;
  return 0.3 * Math.sin(x) + 0.15 * Math.sin(2 * x) + 0.08 * Math.sin(3 * x);
});

test('finds the pitch of pure tones across the speaking range', () => {
  for (const hz of [85, 120, 180, 240, 320]) {
    const got = yinPitch(sine(hz));
    assert.ok(got && Math.abs(got - hz) < hz * 0.02, `${hz} Hz → ${got}`);
  }
});

test('finds the fundamental of a tone with harmonics (not an octave off)', () => {
  for (const hz of [110, 200]) {
    const got = yinPitch(voice(hz));
    assert.ok(got && Math.abs(got - hz) < hz * 0.03, `${hz} Hz → ${got}`);
  }
});

test('noise and silence have no pitch', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  assert.equal(yinPitch(Float32Array.from({ length: FRAME }, () => 0.3 * rand())), null);
  assert.equal(analyzeFrame(new Float32Array(FRAME)).hz, null);
  assert.equal(analyzeFrame(new Float32Array(FRAME)).db, -90);
});

test('loudness in dBFS', () => {
  assert.ok(Math.abs(rmsDb(sine(200, 1)) - -3.01) < 0.1); // a full-scale sine is about -3 dBFS
  assert.ok(Math.abs(rmsDb(sine(200, 0.1)) - -23.01) < 0.1);
});

test('float to 16-bit PCM clamps', () => {
  assert.deepEqual([...floatToInt16(Float32Array.from([0, 1, -1, 2, -2]))], [0, 32767, -32768, 32767, -32768]);
});

test('quantile and semitones', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([], 0.5), NaN);
  assert.ok(Math.abs(semitones(440, 220) - 12) < 1e-9);
});
