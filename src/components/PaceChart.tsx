import { useState } from 'preact/hooks';
import type { Cents } from '../types';
import { compactMoney } from './charts';
import { formatMoney } from '../lib/money';

const W = 326;
const H = 172;
const PAD = { l: 4, r: 46, t: 14, b: 22 };

/** A round step for the y axis (250, 500, 1k, 2.5k…) that gives about three gridlines. */
function niceStep(max: number) {
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/**
 * This month's everyday spending, day by day, against an even pace to the target (a dashed line from
 * nothing on the 1st to the target at month end). Touch or hover a day to read it.
 */
export function PaceChart(props: { curve: Cents[]; days: number; target: Cents; targetLabel: string; monthShort: string }) {
  const { curve, days, target } = props;
  const [hover, setHover] = useState<number | null>(null);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const max = Math.max(target, ...curve, 1);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const X = (day: number) => PAD.l + ((day - 1) / Math.max(1, days - 1)) * iw;
  const Y = (v: number) => PAD.t + ih - (v / top) * ih;
  const today = curve.length;
  const pts = curve.map((v, i) => `${X(i + 1).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `M${X(1)},${Y(0)} L${pts.replace(/ /g, ' L')} L${X(today)},${Y(0)} Z`;
  const paceAt = (day: number) => Math.round((target * day) / days);
  const shown = hover ?? today;
  const grid = [];
  for (let v = step; v < top + 1; v += step) grid.push(v);

  const pick = (e: PointerEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    const day = Math.round(((x - PAD.l) / iw) * (days - 1)) + 1;
    setHover(Math.max(1, Math.min(today, day)));
  };

  return (
    <figure class="pace-chart">
      <figcaption class="pace-readout" aria-live="polite">
        <span>
          {props.monthShort} {shown}
          {shown === today ? ' · today' : ''}
        </span>
        <span>
          <strong class="num">{formatMoney(curve[shown - 1] ?? 0, { whole: true })}</strong> spent ·{' '}
          <span class="num">{formatMoney(paceAt(shown), { whole: true })}</span> pace
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="pace-svg"
        role="img"
        aria-label={`Spent ${formatMoney(curve[today - 1] ?? 0, { whole: true })} by day ${today}, against an even pace of ${formatMoney(paceAt(today), { whole: true })} toward ${props.targetLabel.toLowerCase()} of ${formatMoney(target, { whole: true })}.`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
      >
        {grid.map((v) => (
          <g>
            <line x1={PAD.l} x2={PAD.l + iw} y1={Y(v)} y2={Y(v)} class="grid" />
            <text x={PAD.l + iw + 6} y={Y(v) + 4} class="tick">
              {compactMoney(v)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l + iw} y1={Y(0)} y2={Y(0)} class="axis-base" />
        <line x1={X(1)} y1={Y(0)} x2={X(days)} y2={Y(target)} class="pace-line" />
        <text x={X(days) - 2} y={Y(target) - 8} class="tick" text-anchor="end">
          {props.targetLabel} {compactMoney(target)}
        </text>
        <path d={area} class="pace-area" />
        <polyline points={pts} class="pace-glow" />
        <polyline points={pts} class="pace-you" />
        {hover != null && <line x1={X(hover)} x2={X(hover)} y1={PAD.t} y2={Y(0)} class="crosshair" />}
        <circle cx={X(shown)} cy={Y(paceAt(shown))} r={4} class="pace-dot-pace" />
        <circle cx={X(shown)} cy={Y(curve[shown - 1] ?? 0)} r={6} class="pace-dot" />
        <text x={X(1)} y={H - 4} class="tick">
          {props.monthShort} 1
        </text>
        {today > 4 && today < days - 4 && (
          <text x={X(today)} y={H - 4} class="tick tick-strong" text-anchor="middle">
            Today
          </text>
        )}
        <text x={X(days)} y={H - 4} class="tick" text-anchor="end">
          {props.monthShort} {days}
        </text>
      </svg>
      <div class="legend">
        <span class="readout-item">
          <span class="key-line" style={{ background: 'var(--chart-1)' }} /> You
        </span>
        <span class="readout-item">
          <span class="key-dash" /> Even pace
        </span>
      </div>
    </figure>
  );
}
