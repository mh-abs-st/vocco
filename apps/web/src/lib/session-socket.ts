// The /session WebSocket: send audio, receive words. Protocol: packages/shared/src/protocol.js.

import type { Word } from './types';

export type ServerMessage =
  | { type: 'ready'; maxMinutes: number }
  | { type: 'words'; final: boolean; text: string; words: Word[] }
  | { type: 'utterance_end' }
  | { type: 'limit'; reason: string; message: string }
  | { type: 'error'; message: string }
  | { type: 'closed'; seconds: number };

export function sessionUrl() {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/session`;
}

export class SessionSocket {
  private ws: WebSocket;
  private queue: ArrayBuffer[] = [];
  closed = false;

  constructor(onMessage: (m: ServerMessage) => void, opts: { language: string }) {
    this.ws = new WebSocket(sessionUrl());
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ type: 'start', language: opts.language, sampleRate: 16000 }));
      for (const b of this.queue) this.ws.send(b);
      this.queue = [];
    };
    this.ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(String(e.data)));
      } catch {}
    };
    this.ws.onclose = () => {
      if (!this.closed) onMessage({ type: 'closed', seconds: 0 });
      this.closed = true;
    };
    this.ws.onerror = () => {
      if (this.ws.readyState !== WebSocket.OPEN && !this.closed) onMessage({ type: 'error', message: 'Couldn’t reach Vocco. Check your connection and try again.' });
    };
  }

  sendAudio(pcm: Int16Array) {
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(buf);
    else if (this.ws.readyState === WebSocket.CONNECTING && this.queue.length < 250) this.queue.push(buf); // ≤ 5 s
  }

  stop() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'stop' }));
    else this.ws.close();
  }

  close() {
    this.closed = true;
    try {
      this.ws.close();
    } catch {}
  }
}
