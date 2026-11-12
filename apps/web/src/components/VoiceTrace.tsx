import { useEffect, useRef, type RefObject } from 'react';
import type { VoiceFrame } from '../audio/mic';

const WINDOW_S = 8;
const RANGE_ST = 8; // ± semitones shown around your normal pitch

/** Live pitch line (last 8 s, relative to your normal pitch) and a loudness bar. Drawn on a canvas. */
export function VoiceTrace({ frames, now, baselineHz }: { frames: RefObject<VoiceFrame[]>; now: RefObject<number>; baselineHz?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const dpr = devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== w * dpr) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = now.current ?? 0;
      const recent = (frames.current ?? []).filter((f) => f.t >= t - WINDOW_S);
      const voiced = recent.filter((f) => f.hz).map((f) => f.hz as number);
      const ref = baselineHz || (voiced.length ? [...voiced].sort((a, b) => a - b)[Math.floor(voiced.length / 2)] : 160);
      const barW = 10;
      const plotW = w - barW - 8;

      // Mid line = your normal pitch.
      ctx.strokeStyle = 'rgba(31,42,68,0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(plotW, h / 2);
      ctx.stroke();

      ctx.strokeStyle = '#ff7a59';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (const f of recent) {
        const x = ((f.t - (t - WINDOW_S)) / WINDOW_S) * plotW;
        if (!f.hz) {
          pen = false;
          continue;
        }
        const st = Math.max(-RANGE_ST, Math.min(RANGE_ST, 12 * Math.log2(f.hz / ref)));
        const y = h / 2 - (st / RANGE_ST) * (h / 2 - 4);
        if (pen) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();

      // Loudness bar (last frame), -60..-10 dBFS.
      const last = recent.at(-1);
      const lvl = last ? Math.max(0, Math.min(1, (last.db + 60) / 50)) : 0;
      ctx.fillStyle = 'rgba(31,42,68,0.1)';
      ctx.fillRect(w - barW, 0, barW, h);
      ctx.fillStyle = '#1f2a44';
      ctx.fillRect(w - barW, h - lvl * h, barW, lvl * h);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [frames, now, baselineHz]);

  return <canvas ref={canvas} className="voice-trace" aria-label="Your pitch and loudness" />;
}
