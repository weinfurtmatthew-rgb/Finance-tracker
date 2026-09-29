import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { Cents } from '../../types';
import { formatMoney, parseUserAmount } from '../../lib/money';
import { compactMoney } from '../../components/charts';
import { monthLabel } from '../../lib/dates';
import { Field } from '../../components/ui';

export const money = (c: Cents) => formatMoney(c, { whole: true });
/** Money that must fit a tile: $2,271 but $17.4K. */
export const tile = (c: Cents) => (Math.abs(c) >= 1_000_000 ? compactMoney(c) : money(c));
export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits).replace(/\.0+$/, '')}%`;

/** "8.7 months", "1.3 years"; `short` gives "8.7 mo" / "1.3 yrs" for tiles. */
export function duration(months: number, short = false): string {
  if (!Number.isFinite(months)) return 'forever';
  if (months < 12) {
    const n = months.toFixed(months < 10 ? 1 : 0).replace(/\.0$/, '');
    return short ? `${n} mo` : `${n} month${n === '1' ? '' : 's'}`;
  }
  const y = months / 12;
  const n = y.toFixed(y < 10 ? 1 : 0).replace(/\.0$/, '');
  return short ? `${n} yr${n === '1' ? '' : 's'}` : `${n} year${n === '1' ? '' : 's'}`;
}

/** "Jun–Aug" for the months an average is based on. */
export function monthsRange(keys: string[]): string {
  if (!keys.length) return 'no full months yet';
  const short = (k: string) => monthLabel(k, { short: true }).split(' ')[0];
  return keys.length === 1 ? short(keys[0]) : `${short(keys[0])}–${short(keys[keys.length - 1])}`;
}

const toInput = (c: Cents) => (c ? String(Math.round(Math.abs(c) / 100)) : '');
const pctInput = (x: number) => String(Math.round(x * 10000) / 100);

/** A money input seeded once from your data; returns [cents, field]. */
export function useMoney(initial: Cents): [Cents, string, (v: string) => void] {
  const [text, setText] = useState(toInput(initial));
  return [parseUserAmount(text) ?? 0, text, setText];
}

/** A percent input ("7" → 0.07). */
export function usePercent(initial: number): [number, string, (v: string) => void] {
  const [text, setText] = useState(pctInput(initial));
  const n = parseFloat(text);
  return [Number.isFinite(n) ? n / 100 : 0, text, setText];
}

/** A whole-number input (years, months). */
export function useCount(initial: number, max = 100): [number, string, (v: string) => void] {
  const [text, setText] = useState(String(initial));
  const n = Math.round(parseFloat(text));
  return [Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0, text, setText];
}

const onText = (set: (v: string) => void) => (e: Event) => set((e.target as HTMLInputElement).value);

export function MoneyField(props: { label: string; value: string; set: (v: string) => void; hint?: ComponentChildren }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <input inputMode="decimal" class="money-input" value={props.value} placeholder="0" onInput={onText(props.set)} aria-label={props.label} />
    </Field>
  );
}

export function PercentField(props: { label: string; value: string; set: (v: string) => void; hint?: ComponentChildren }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <input inputMode="decimal" value={props.value} placeholder="0" onInput={onText(props.set)} aria-label={props.label} />
      <span class="affix">%</span>
    </Field>
  );
}

export function CountField(props: { label: string; unit: string; value: string; set: (v: string) => void; hint?: ComponentChildren }) {
  return (
    <Field label={props.label} hint={props.hint}>
      <input inputMode="numeric" value={props.value} placeholder="0" onInput={onText(props.set)} aria-label={props.label} />
      <span class="affix">{props.unit}</span>
    </Field>
  );
}

export function Stat(props: { label: string; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="kpi">
      <span class="card-label">{props.label}</span>
      <span class="kpi-value">{props.value}</span>
      {props.sub && <span class="card-sub">{props.sub}</span>}
    </div>
  );
}

export type Status = 'good' | 'warning' | 'critical';
const STATUS_ICON: Record<Status, string> = {
  good: '✓',
  warning: '!',
  critical: '✕',
};

/** The big answer at the top of a calculator, with an optional status (always icon + words). */
export function Answer(props: { label: string; value: ComponentChildren; sub?: ComponentChildren; status?: Status; statusText?: string }) {
  return (
    <div class="hero-card plan-answer">
      <span class="card-label">{props.label}</span>
      <span class="hero-number">{props.value}</span>
      {props.sub && <span class="card-sub">{props.sub}</span>}
      {props.status && (
        <span class={`status-badge ${props.status}`}>
          <span aria-hidden="true">{STATUS_ICON[props.status]}</span> {props.statusText}
        </span>
      )}
    </div>
  );
}

/** A 0–100% progress bar toward a target. */
export function Progress(props: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, props.value));
  return (
    <div class="plan-progress" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={props.label}>
      <span style={{ width: `${Math.max(1.5, v * 100)}%` }} />
    </div>
  );
}

export const DISCLAIMER = 'Estimates, not advice. They use your own numbers and simple assumptions, and real returns, rates and prices will differ.';

/** Year-by-year dates and labels for charting projections. */
export function yearAxis(years: number): { dates: string[]; labels: string[] } {
  const y0 = new Date().getFullYear();
  const list = Array.from({ length: years + 1 }, (_, i) => i);
  return {
    dates: list.map((i) => `${y0 + i}-01-01`),
    labels: list.map((i) => String(y0 + i)),
  };
}
