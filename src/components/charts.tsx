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

/** Axis ticks covering [min, max], including 0 (at most ~5 ticks). */
export function niceRange(min: number, max: number): number[] {
  if (min >= 0) return niceScale(max);
  const span = Math.max(1, max - Math.min(0, min));
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(0, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/**
 * Line chart over dates (x spaced by real time). One series gets a light area wash; two series get a
 * legend. A crosshair snaps to the nearest point and the readout above shows every series there.
 */
export function LineChart(props: {
  dates: string[];
  labels: string[];
  series: Series[];
  title: string;
  height?: number;
}) {
  const { dates, series } = props;
  const [active, setActive] = useState<number | null>(null);
  const H = props.height ?? 160;
  const plotW = W - AXIS_W - 8;
  const all = series.flatMap((s) => s.values);
  const ticks = niceRange(Math.min(0, ...all), Math.max(1, ...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => 8 + (H - 16) * (1 - (v - lo) / (hi - lo || 1));
  const t0 = Date.parse(dates[0]);
  const t1 = Date.parse(dates[dates.length - 1]);
  const x = (i: number) => AXIS_W + (dates.length === 1 ? plotW : ((Date.parse(dates[i]) - t0) / (t1 - t0 || 1)) * plotW);
  const shown = active ?? dates.length - 1;
  const single = series.length === 1;

  const onMove = (e: PointerEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setActive(Math.max(0, shown - 1));
    if (e.key === 'ArrowRight') setActive(Math.min(dates.length - 1, shown + 1));
  };
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  return (
    <figure class="chart" aria-label={props.title}>
      <div class="chart-readout" aria-live="polite">
        <span class="muted">{props.labels[shown]}</span>
        <span class="readout-values">
          {series.map((s) => (
            <span class="readout-item">
              {!single && <i class="key-line" style={{ background: s.color }} />}
              <strong>{compactMoneyFull(s.values[shown] ?? 0)}</strong>
              {!single && <span class="muted"> {s.name}</span>}
            </span>
          ))}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + X_AXIS_H}`}
        role="img"
        aria-label={props.title}
        class="chart-svg"
        tabIndex={0}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g>
            <line x1={AXIS_W} x2={W} y1={y(t)} y2={y(t)} class={t === 0 ? 'axis-base' : 'grid'} />
            <text x={AXIS_W - 6} y={y(t) + 4} class="tick" text-anchor="end">
              {compactMoney(t)}
            </text>
          </g>
        ))}
        {single && dates.length > 1 && (
          <path d={`${line(series[0].values)}L${x(dates.length - 1)},${y(Math.max(lo, 0))}L${x(0)},${y(Math.max(lo, 0))}Z`} fill={series[0].color} opacity="0.1" />
        )}
        {series.map((s) => (
          <path d={line(s.values)} fill="none" stroke={s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        ))}
        {active != null && <line x1={x(shown)} x2={x(shown)} y1={4} y2={H} class="crosshair" />}
        {series.map((s) => (
          <circle cx={x(shown)} cy={y(s.values[shown] ?? 0)} r="4.5" fill={s.color} class="dot" />
        ))}
        {[0, Math.floor((dates.length - 1) / 2), dates.length - 1]
          .filter((i, k, arr) => arr.indexOf(i) === k)
          .map((i) => (
            <text x={x(i)} y={H + 15} class="tick" text-anchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}>
              {props.labels[i]}
            </text>
          ))}
      </svg>
      {!single && (
        <figcaption class="legend">
          {series.map((s) => (
            <span>
              <i class="key-line" style={{ background: s.color }} /> {s.name}
            </span>
          ))}
        </figcaption>
      )}
      <details class="chart-table">
        <summary>Show as table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {series.map((s) => (
                <th scope="col">{s.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((_, i) => (
              <tr>
                <th scope="row">{props.labels[i]}</th>
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
