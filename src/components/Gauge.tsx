import { useId } from 'preact/hooks';
import type { Verdict } from '../lib/today';

const polar = (c: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
};
const arc = (c: number, r: number, a1: number, a2: number) => {
  const [x1, y1] = polar(c, r, a1);
  const [x2, y2] = polar(c, r, a2);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/** Status color for a verdict (status colors are only used for verdicts like this). */
export const verdictColor = (v: Verdict) =>
  v === 'Go For It' || v === 'On Track' ? 'var(--status-good)' : v === 'Pace Yourself' ? 'var(--status-warning)' : 'var(--status-critical)';

/** The Spend Readiness dial: ten segments over three quarters of a circle, lit up to the score. */
export function Gauge(props: { score: number; verdict: Verdict; size: number; stroke: number }) {
  const { size, stroke } = props;
  const c = size / 2;
  const r = size / 2 - stroke / 2 - 2;
  const span = 270 / 10;
  const color = verdictColor(props.verdict);
  const id = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const segs = Array.from({ length: 10 }, (_, i) => ({ d: arc(c, r, 135 + i * span + 2.4, 135 + (i + 1) * span - 2.4), on: i < props.score }));
  return (
    <svg class="gauge" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <defs>
        <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation={stroke * 0.7} />
        </filter>
      </defs>
      <g filter={`url(#${id})`} opacity={0.55}>
        {segs.filter((s) => s.on).map((s) => (
          <path d={s.d} fill="none" stroke={color} stroke-width={stroke} stroke-linecap="round" />
        ))}
      </g>
      {segs.map((s) => (
        <path d={s.d} fill="none" stroke={s.on ? color : 'var(--track)'} stroke-width={stroke} stroke-linecap="round" />
      ))}
    </svg>
  );
}
