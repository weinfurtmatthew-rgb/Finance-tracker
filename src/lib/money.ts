import type { Cents } from '../types';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function formatMoney(cents: Cents, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const fmt = opts.whole ? usdWhole : usd;
  const text = fmt.format(cents / 100);
  return opts.sign && cents > 0 ? `+${text}` : text;
}

/**
 * Parse an amount as written in bank exports into cents.
 * Handles "$1,234.56", "-12.00", "(12.00)", "12.00-", "+5", "1 234,00" is NOT supported (US only).
 * Returns null when the text isn't a number (e.g. an empty debit column).
 */
export function parseAmount(raw: string | undefined | null): Cents | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (/\bCR$/i.test(s)) s = s.replace(/\s*CR$/i, '');
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  s = s.replace(/^\$/, '');
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Parse what a person typed into an amount field (always treated as positive). */
export function parseUserAmount(raw: string): Cents | null {
  const cents = parseAmount(raw);
  return cents == null ? null : Math.abs(cents);
}

export function centsToInput(cents: Cents): string {
  return (Math.abs(cents) / 100).toFixed(2);
}
