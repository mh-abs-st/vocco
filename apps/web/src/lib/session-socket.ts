// The /session WebSocket: send audio, receive words. Protocol: packages/shared/src/protocol.js.
//
// Audio is sent only after the server says 'ready'. Deepgram counts word times from the first chunk it gets, so
// the caller notes the mic time of that first chunk (`onFirstChunk`) and adds it to every word: word times then
// stay on the mic's clock, also after a reconnect.

import type { Word } from './types';

export type ServerMessage =
  | { type: 'ready'; maxMinutes: number }
  | { type: 'words'; final: boolean; text: string; words: Word[] }
  | { type: 'utterance_end' }
  | { type: 'limit'; reason: string; message: string }
  | { type: 'error'; message: string; reason?: string }
  | { type: 'closed'; seconds: number };

export function sessionUrl() {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/session`;
}

export class SessionSocket {
  private ws: WebSocket;
  private ready = false;
  private sentAny = false;
  /** True once we closed it ourselves (no 'closed' message is reported after that). */
  closed = false;

  constructor(onMessage: (m: ServerMessage) => void, opts: { language: string; token?: string | null }) {
    this.ws = new WebSocket(sessionUrl());
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'start', language: opts.language, sampleRate: 16000, ...(opts.token ? { token: opts.token } : {}) }));
    };
    this.ws.onmessage = (e) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === 'ready') this.ready = true;
      onMessage(m);
    };
    this.ws.onclose = () => {
      this.ready = false;
      if (!this.closed) onMessage({ type: 'closed', seconds: 0 });
      this.closed = true;
    };
    this.ws.onerror = () => {
      if (!this.ready && !this.closed) onMessage({ type: 'error', message: 'Couldn’t reach Vocco. Check your connection and try again.' });
    };
  }

  /** Is it listening (ready and open)? */
  get live() {
    return this.ready && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send one chunk if listening. Returns true when sent. `onFirstChunk` runs before the first chunk goes out.
   */
  sendAudio(pcm: Int16Array, onFirstChunk?: () => void) {
    if (!this.live) return false;
    if (!this.sentAny) {
      this.sentAny = true;
      onFirstChunk?.();
    }
    this.ws.send(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer);
    return true;
  }

  /** Ask the server to finish (last words, then it closes). */
  stop() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'stop' }));
    else this.close();
  }

  close() {
    this.closed = true;
    this.ready = false;
    try {
      this.ws.close();
    } catch {}
  }
}
