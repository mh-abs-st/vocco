// Deepgram live speech-to-text: the stream URL, opening it, and turning its messages into ours.
// Adapted from Offro's backend/deepgram.js. Nova-3 because coaching needs filler words ("um", "uh"), which
// Deepgram's Flux model doesn't return.

import { fromDeepgram } from '@vocco/shared/words';

export const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen';
export const DEEPGRAM_USD_PER_MIN = 0.0077; // Nova-3 streaming, pay-as-you-go list price (check deepgram.com/pricing)

/** Query string for a coaching stream: raw 16-bit PCM from the browser, word timings, fillers kept. */
export function listenParams({ model = 'nova-3', language = 'en', sampleRate = 16000 } = {}) {
  return new URLSearchParams({
    model,
    language,
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    punctuate: 'true', // sentence ends drive the pause and "land it" rules
    smart_format: 'true',
    filler_words: 'true',
    interim_results: 'true',
    utterance_end_ms: '1500',
    vad_events: 'true',
    endpointing: '300',
    mip_opt_out: 'true', // users' audio is never used to train Deepgram's models
  });
}

export const listenUrl = (opts) => `${DEEPGRAM_URL}?${listenParams(opts)}`;

/**
 * Open the stream. Deepgram takes the key as a WebSocket subprotocol, so Node's built-in WebSocket works
 * (no custom headers needed).
 */
export function openDeepgram({ key, url, WebSocketImpl = globalThis.WebSocket }) {
  const ws = new WebSocketImpl(url, ['token', key]);
  ws.binaryType = 'arraybuffer';
  return ws;
}

/** Deepgram message → messages for the browser (often none). Also reports billed seconds when it knows them. */
export function toClient(msg) {
  if (!msg || typeof msg !== 'object') return [];
  if (msg.type === 'Results') {
    const alt = msg.channel?.alternatives?.[0];
    const words = (alt?.words || []).map(fromDeepgram);
    if (!words.length) return [];
    return [{ type: 'words', final: Boolean(msg.is_final), text: String(alt.transcript || ''), words }];
  }
  if (msg.type === 'UtteranceEnd') return [{ type: 'utterance_end' }];
  return [];
}

export const CLOSE_STREAM = JSON.stringify({ type: 'CloseStream' });
export const KEEP_ALIVE = JSON.stringify({ type: 'KeepAlive' });

/** One log line per stream, to compare with Deepgram's dashboard. */
export function usageLine({ model, language, seconds, requestId }) {
  const s = Math.max(0, Number(seconds) || 0);
  return `[usage] deepgram ${model} ${language} seconds=${s.toFixed(1)} ~$${((s / 60) * DEEPGRAM_USD_PER_MIN).toFixed(4)}${requestId ? ` request=${requestId}` : ''}`;
}
