// Pitch and loudness from raw audio, computed in the browser for each short frame of the mic signal.
// Pitch: the YIN method (de Cheveigné & Kawahara, 2002), limited to the range of speaking voices.

export const SAMPLE_RATE = 16000;
export const FRAME = 1024; // 64 ms at 16 kHz: long enough for two periods of a 75 Hz voice
export const HOP = 320; // a new frame every 20 ms
const MIN_HZ = 70;
const MAX_HZ = 450;
const YIN_THRESHOLD = 0.15;
const SILENCE_DB = -55;

/** Loudness of a frame in dBFS (0 = full scale). Silence is about -90. */
export function rmsDb(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / Math.max(1, frame.length));
  return rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90;
}

/**
 * Fundamental frequency of a frame in Hz, or null when the frame is unvoiced, too quiet or out of range.
 * @param {Float32Array} frame
 * @param {number} [sampleRate]
 */
export function yinPitch(frame, sampleRate = SAMPLE_RATE) {
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(frame.length / 2));
  if (maxLag <= minLag + 2) return null;
  const w = frame.length - maxLag; // integration window
  const d = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const diff = frame[i] - frame[i + lag];
      s += diff * diff;
    }
    d[lag] = s;
  }
  // Cumulative mean normalized difference.
  const c = new Float32Array(maxLag + 1);
  c[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    running += d[lag];
    c[lag] = running > 0 ? (d[lag] * lag) / running : 1;
  }
  let tau = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (c[lag] < YIN_THRESHOLD) {
      while (lag + 1 <= maxLag && c[lag + 1] < c[lag]) lag++;
      tau = lag;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum for sub-sample accuracy.
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const a = c[tau - 1], b = c[tau], g = c[tau + 1];
    const denom = a + g - 2 * b;
    if (denom !== 0) better = tau + (a - g) / (2 * denom);
  }
  const hz = sampleRate / better;
  return hz >= MIN_HZ && hz <= MAX_HZ ? hz : null;
}

/**
 * One analysis result for a frame: loudness always, pitch only when voiced and loud enough.
 * @returns {{ db: number, hz: number|null }}
 */
export function analyzeFrame(frame, sampleRate = SAMPLE_RATE) {
  const db = rmsDb(frame);
  const hz = db > SILENCE_DB ? yinPitch(frame, sampleRate) : null;
  return { db, hz };
}

/** Semitones between two frequencies (positive when `hz` is higher than `ref`). */
export const semitones = (hz, ref) => 12 * Math.log2(hz / ref);

/** Value at quantile q (0..1) of a list of numbers; NaN for an empty list. */
export function quantile(values, q) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

/** Float32 [-1, 1] → Int16 PCM (what Deepgram's `linear16` expects). */
export function floatToInt16(frame) {
  const out = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
