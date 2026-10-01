import { useId } from 'preact/hooks';
import type { Pillar, PillarKey } from '../lib/health';
import type { GlyphName, Hue } from './icons';

/** Each part of Money Health keeps one color and icon everywhere. */
export const PILLAR_LOOK: Record<PillarKey, { glyph: GlyphName; hue: Hue }> = {
  earn: { glyph: 'income', hue: 'aqua' },
  bills: { glyph: 'calendar', hue: 'violet' },
  cushion: { glyph: 'vault', hue: 'blue' },
  invest: { glyph: 'trend', hue: 'green' },
  debt: { glyph: 'card', hue: 'orange' },
  planning: { glyph: 'target', hue: 'magenta' },
};

const polar = (c: number, r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
};
const arc = (c: number, r: number, a1: number, a2: number) => {
  const [x1, y1] = polar(c, r, a1);
  const [x2, y2] = polar(c, r, a2);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/** Six arcs, one per part, each filled to its score, with the overall score in the middle. */
export function HealthRing(props: { pillars: Pillar[]; score: number; band: string; size: number; stroke: number }) {
  const { size, stroke } = props;
  const c = size / 2;
  const r = size / 2 - stroke / 2 - 2;
  const id = `r${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const segs = props.pillars.map((p, i) => {
    const a1 = -90 + i * 60 + 3.5;
    const a2 = -90 + (i + 1) * 60 - 3.5;
    return { track: arc(c, r, a1, a2), fill: p.score > 0 ? arc(c, r, a1, a1 + Math.max(0.5, ((a2 - a1) * p.score) / 100)) : null, color: `var(--hue-${PILLAR_LOOK[p.key].hue})` };
  });
  return (
    <div class="health-ring" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <filter id={id} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation={stroke * 0.75} />
          </filter>
        </defs>
        {segs.map((s) => (
          <path d={s.track} fill="none" stroke="var(--track)" stroke-width={stroke} stroke-linecap="round" />
        ))}
        <g filter={`url(#${id})`} opacity={0.5}>
          {segs.map((s) => s.fill && <path d={s.fill} fill="none" stroke={s.color} stroke-width={stroke} stroke-linecap="round" />)}
        </g>
        {segs.map((s) => s.fill && <path d={s.fill} fill="none" stroke={s.color} stroke-width={stroke} stroke-linecap="round" />)}
      </svg>
      <div class="health-center">
        <span class="health-score num" style={{ fontSize: `${Math.round(size / 3.6)}px` }}>
          {props.score}
        </span>
        <span class="health-band" style={{ fontSize: `${Math.max(11, Math.round(size / 13))}px` }}>
          {props.band}
        </span>
      </div>
    </div>
  );
}
