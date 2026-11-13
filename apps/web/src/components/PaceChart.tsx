/** Words per minute for each 5 or 10 seconds (`bucket`), with the comfortable band shaded. Plain SVG. */
export function PaceChart({ series, target, bucket = 10 }: { series: { t: number; wpm: number }[]; target: number[]; bucket?: number }) {
  const W = 640, H = 180, PAD = 32;
  const maxT = Math.max(bucket, ...series.map((p) => p.t + bucket));
  const mid = (t: number) => t + bucket / 2; // each point sits in the middle of its stretch
  const maxW = Math.max(220, ...series.map((p) => p.wpm));
  const x = (t: number) => PAD + (t / maxT) * (W - PAD * 2);
  const y = (w: number) => H - PAD - (w / maxW) * (H - PAD * 2);
  const points = series.map((p) => `${x(mid(p.t))},${y(p.wpm)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="pace-chart" role="img" aria-label="Pace over time">
      <rect x={PAD} width={W - PAD * 2} y={y(target[1])} height={y(target[0]) - y(target[1])} fill="rgba(46,160,120,0.12)" />
      <text x={W - PAD} y={y(target[1]) - 4} textAnchor="end" className="axis">comfortable {target[0]}–{target[1]}</text>
      <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="rgba(31,42,68,0.2)" />
      <polyline points={points} fill="none" stroke="#1f2a44" strokeWidth={2.5} strokeLinejoin="round" />
      {series.map((p, i) => (
        <circle key={i} cx={x(mid(p.t))} cy={y(p.wpm)} r={3.5} fill="#ff7a59">
          <title>{`${p.t}–${p.t + bucket} s: ${p.wpm} words/min`}</title>
        </circle>
      ))}
      <text x={PAD} y={H - 10} className="axis">0:00</text>
      <text x={W - PAD} y={H - 10} textAnchor="end" className="axis">{Math.floor(maxT / 60)}:{String(maxT % 60).padStart(2, '0')}</text>
    </svg>
  );
}
