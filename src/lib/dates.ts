import type { ISODate } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

function valid(y: number, m: number, d: number): ISODate | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(y, m - 1, d);
  if (date.getMonth() !== m - 1) return null; // e.g. 02/31
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse the date formats US banks put in exports. Returns null if it isn't a date. */
export function parseBankDate(raw: string | undefined | null): ISODate | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m: RegExpMatchArray | null;
  // 2026-09-28 or 2026/09/28 (optionally followed by a time)
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/))) return valid(+m[1], +m[2], +m[3]);
  // 09/28/2026, 9/28/26, 09-28-2026
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\b/))) {
    let y = +m[3];
    if (m[3].length === 2) y += y > 70 ? 1900 : 2000;
    return valid(y, +m[1], +m[2]);
  }
  // OFX style 20260928 or 20260928120000[-5:EST]
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return valid(+m[1], +m[2], +m[3]);
  // Sep 28, 2026 / 28 Sep 2026 / Sep-28-2026
  if ((m = s.match(/^([A-Za-z]{3})[a-z]*[ -](\d{1,2}),?[ -](\d{4})$/))) {
    const mon = MONTHS[m[1].toLowerCase()];
    return mon ? valid(+m[3], mon, +m[2]) : null;
  }
  if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{4})$/))) {
    const mon = MONTHS[m[2].toLowerCase()];
    return mon ? valid(+m[3], mon, +m[1]) : null;
  }
  return null;
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

export function monthLabel(key: string, opts: { short?: boolean } = {}): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: opts.short ? 'short' : 'long',
    year: 'numeric',
  });
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatDay(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = todayISO();
  if (date === today) return 'Today';
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  if (date === toISODate(yest)) return 'Yesterday';
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: y === new Date().getFullYear() ? undefined : 'numeric',
  });
}

// ---- Day arithmetic (done in UTC so daylight-saving changes never shift a date) ----

const utc = (d: ISODate) => {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
};
const fromUtc = (ms: number): ISODate => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export function addDays(date: ISODate, n: number): ISODate {
  return fromUtc(utc(date) + n * 86_400_000);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** The given day of a month offset from `date`'s month, clamped to the month's length (31 → 30/28). */
export function dayInMonth(date: ISODate, monthOffset: number, day: number): ISODate {
  const [y, m] = date.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + monthOffset, 1));
  const yy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(day, daysInMonth(yy, mm)))}`;
}

export function dayOfMonth(date: ISODate): number {
  return Number(date.slice(8, 10));
}

export function formatShortDate(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "Thursday, October 1": the date above the Today title. */
export function formatLongDay(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
