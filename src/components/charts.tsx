import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/** Compact money for axes and tight labels: $950, $1.2K, $12K, $1.4M. */
export function compactMoney(cents: number): string {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  if (d >= 1_000_000) return `${sign}$${(d / 1_000_000).toFixed(d >= 10_000_000 ? 0 : 1)}M`;
  if (d >= 1000) return `${sign}$${(d / 1000).toFixed(d >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `${sign}$${Math.round(d)}`;
}

/** A "nice" axis maximum and its tick values (0, half, max). */
export function niceScale(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 2;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return [0, step, step * 2];
}

/** Bar with a 4px rounded data-end, square at the baseline. */
function barPath(x: number, y: number, w: number, base: number): string {
  const h = base - y;
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

const W = 340;
const AXIS_W = 40;
const X_AXIS_H = 20;

interface Series {
  name: string;
  color: string;
  values: number[];
}

export interface ChartColumn {
  key: string;
  label: string;
}

/**
 * Column chart for one or two series over time. With one series, the selected column is emphasized
 * (accent) and the others recede (gray). With two series, columns are grouped and a legend is shown.
 */
export function ColumnChart(props: {
  columns: ChartColumn[];
  series: Series[];
  selected?: string;
  onSelect?: (key: string) => void;
  /** A horizontal reference line, e.g. a budget limit. */
  reference?: { value: number; label: string };
  height?: number;
  title: string;
  /** Extra line for the readout (e.g. "Saved $400"). */
  readoutExtra?: (index: number) => ComponentChildren;
  tableLabels?: string[];
}) {
  const { columns, series } = props;
  const [active, setActive] = useState<number | null>(null);
  const H = props.height ?? 150;
  const plotW = W - AXIS_W;
  const max = Math.max(1, ...series.flatMap((s) => s.values), props.reference?.value ?? 0);
  const ticks = niceScale(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => 8 + (H - 8) * (1 - Math.max(0, v) / top);
  const band = plotW / Math.max(1, columns.length);
  const single = series.length === 1;
  const gap = 2;
  const barW = Math.min(24, single ? band * 0.62 : (band * 0.78 - gap) / series.length);
  const selIndex = columns.findIndex((c) => c.key === props.selected);
  const shown = active ?? (selIndex >= 0 ? selIndex : columns.length - 1);
  // Label the x-axis sparsely when there are many columns.
  const every = columns.length > 8 ? 2 : 1;

  return (
    <figure class="chart" aria-label={props.title}>
      <div class="chart-readout" aria-live="polite">
        <span class="muted">{columns[shown]?.label}</span>
        <span class="readout-values">
          {series.map((s) => (
            <span class="readout-item">
              {!single && <i class="key-line" style={{ background: s.color }} />}
              <strong>{compactMoneyFull(s.values[shown] ?? 0)}</strong>
              {!single && <span class="muted"> {s.name}</span>}
            </span>
          ))}
          {props.readoutExtra?.(shown)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + X_AXIS_H}`} role="img" aria-label={props.title} class="chart-svg" onPointerLeave={() => setActive(null)}>
        {ticks.map((t) => (
          <g>
            <line x1={AXIS_W} x2={W} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis-base' : 'grid'} />
            <text x={AXIS_W - 6} y={y(t) + 4} class="tick" text-anchor="end">
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {props.reference && props.reference.value > 0 && (
          <g>
            <line x1={AXIS_W} x2={W} y1={y(props.reference.value)} y2={y(props.reference.value)} class="ref-line" />
            <text x={W} y={y(props.reference.value) - 4} class="tick ref-label" text-anchor="end">
              {props.reference.label}
            </text>
          </g>
        )}
        {columns.map((c, i) => {
          const x0 = AXIS_W + i * band;
          const groupW = single ? barW : series.length * barW + (series.length - 1) * gap;
          const gx = x0 + (band - groupW) / 2;
          const emphasized = !single || i === (selIndex >= 0 ? selIndex : columns.length - 1);
          return (
            <g
              class={`col ${i === shown ? 'active' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={`${c.label}: ${series.map((s) => `${s.name} ${compactMoneyFull(s.values[i] ?? 0)}`).join(', ')}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => props.onSelect?.(c.key)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && props.onSelect?.(c.key)}
            >
              <rect x={x0} y={0} width={band} height={H + X_AXIS_H} class="hit" />
              {series.map((s, si) => (
                <path d={barPath(gx + si * (barW + gap), y(s.values[i] ?? 0), barW, y(0))} fill={single && !emphasized ? 'var(--chart-deemph)' : s.color} />
              ))}
              {(i % every === (columns.length - 1) % every || i === selIndex) && (
                <text x={x0 + band / 2} y={H + 15} class={`tick ${i === selIndex ? 'tick-strong' : ''}`} text-anchor="middle">
                  {c.label.split(' ')[0]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {!single && (
        <figcaption class="legend">
          {series.map((s) => (
            <span>
              <i class="key-rect" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <details class="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {series.map((s) => (
                <th scope="col">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr>
                <th scope="row">{props.tableLabels?.[i] ?? c.label}</th>
                {series.map((s) => (
                  <td>{compactMoneyFull(s.values[i] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const whole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function compactMoneyFull(cents: number): string {
  return whole.format(cents / 100);
}

/** Horizontal ranked bars (one series, one color); the value sits at the bar's tip. */
export function RankedBars(props: {
  items: { key: string; label: ComponentChildren; value: number; note?: string }[];
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...props.items.map((i) => i.value));
  return (
    <div class="ranked">
      {props.items.map((i) => (
        <button type="button" class="ranked-row" onClick={() => props.onSelect?.(i.key)}>
          <span class="ranked-label">{i.label}</span>
          <span class="ranked-bar">
            <span class="ranked-fill" style={{ width: `${Math.max(1.5, (i.value / max) * 100)}%` }} />
            <span class="ranked-value">{compactMoneyFull(i.value)}</span>
          </span>
          {i.note && <span class="ranked-note">{i.note}</span>}
        </button>
      ))}
    </div>
  );
}
