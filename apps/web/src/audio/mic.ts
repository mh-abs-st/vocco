// The microphone: 16 kHz audio from an AudioWorklet, analysed here for pitch and loudness every 20 ms,
// and handed out as 16-bit PCM for speech-to-text. Time `t` is seconds of audio since start, the same clock
// as Deepgram's word times because every sample is streamed.

import { analyzeFrame, floatToInt16, FRAME, HOP, SAMPLE_RATE } from '@vocco/shared/pitch';

export type VoiceFrame = { t: number; db: number; hz: number | null };

// One mic setting everywhere (like Offro): the raw mic. Browser call filters (noise suppression, auto gain)
// change loudness and pitch, which is exactly what we measure.
export const MIC_AUDIO: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export type MicOptions = {
  deviceId?: string;
  onFrame?: (f: VoiceFrame) => void;
  onPcm?: (pcm: Int16Array) => void;
};

export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private ring = new Float32Array(FRAME);
  private samples = 0;
  private opts: MicOptions;

  constructor(opts: MicOptions = {}) {
    this.opts = opts;
  }

  /** Seconds of audio captured so far. */
  get time() {
    return this.samples / SAMPLE_RATE;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...MIC_AUDIO, ...(this.opts.deviceId ? { deviceId: { exact: this.opts.deviceId } } : {}) },
    });
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule('/capture-worklet.js');
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'capture-16k');
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.onChunk(e.data);
    src.connect(this.node);
    // Not connected to the speakers: nothing is played back.
  }

  setHandlers(opts: Omit<MicOptions, 'deviceId'>) {
    this.opts = { ...this.opts, ...opts };
  }

  private onChunk(chunk: Float32Array) {
    // Slide the analysis window by one hop (chunks are HOP = 320 samples).
    const n = chunk.length;
    this.ring.copyWithin(0, n);
    this.ring.set(chunk, FRAME - n);
    this.samples += n;
    if (this.samples >= FRAME && n === HOP) {
      const { db, hz } = analyzeFrame(this.ring);
      this.opts.onFrame?.({ t: (this.samples - FRAME / 2) / SAMPLE_RATE, db, hz });
    }
    this.opts.onPcm?.(floatToInt16(chunk));
  }

  async stop() {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}

export async function listMics(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

/** A friendly message for getUserMedia errors. */
export function micError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Vocco can’t use your microphone. Allow it in the address bar, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in or pick another, then try again.';
  if (name === 'NotReadableError') return 'Another app is using your microphone. Close it, then try again.';
  return 'The microphone couldn’t start. Try again, or pick another one.';
}
