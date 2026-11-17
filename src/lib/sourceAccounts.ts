/**
 * Files that cover several accounts at once (Fidelity's activity download, Rocket Money's export, any
 * CSV with an account column): which account each row is from, and where each of those accounts goes
 * in the app. Where you send each one is remembered, so the next file from there goes to the same places.
 */
import type { Account, AccountType } from '../types';
import type { DraftTransaction, SourceAccount } from './draft';

/** The meta key with where each account from a file went last time: its ref → an app account id, or "skip". */
export const IMPORT_ROUTES = 'importRoutes';
export const SKIP = 'skip';

export interface SourceGroup {
  account: SourceAccount;
  drafts: DraftTransaction[];
}

/** A file's rows grouped by the account they're from, largest first. */
export function groupBySource(drafts: DraftTransaction[]): SourceGroup[] {
  const m = new Map<string, SourceGroup>();
  for (const d of drafts) {
    if (!d.sourceAccount) continue;
    const g = m.get(d.sourceAccount.key) ?? { account: d.sourceAccount, drafts: [] };
    g.drafts.push(d);
    m.set(d.sourceAccount.key, g);
  }
  return [...m.values()].sort((a, b) => b.drafts.length - a.drafts.length);
}

/**
 * An account name with its number at the end, split in two: "Individual - TOD Z12345678" → "Individual -
 * TOD" and "Z12345678"; "ROTH IRA (238123456)" too. A last word counts as a number when it has 4 digits or
 * more (masked ones like ****5678 included).
 */
export function splitAccountNumber(text: string): { name: string; number: string } {
  const words = text.trim().split(/\s+/);
  const last = (words[words.length - 1] ?? '').replace(/^[(#[]+|[)\]]+$/g, '');
  if (words.length > 1 && /^[A-Z0-9*xX.•-]+$/i.test(last) && (last.match(/\d/g) ?? []).length >= 4) {
    return {
      name: words
        .slice(0, -1)
        .join(' ')
        .replace(/[\s:|–—-]+$/, '')
        .trim(),
      number: last,
    };
  }
  return { name: text.trim(), number: '' };
}

/** An app account type from the file's own account type and name ("Roth IRA", "Credit Card"…). */
export function accountTypeFor(a: SourceAccount, fallback: AccountType = 'checking'): AccountType {
  const t = `${a.type ?? ''} ${a.name}`.toLowerCase();
  if (/\bcds?\b|certificate/.test(t)) return 'cd';
  if (/\broth\b/.test(t) && /\bira\b/.test(t)) return 'roth-ira';
  if (/\b40[13]\s*\(?[kb]\b|\btsp\b|thrift savings/.test(t)) return /\broth\b/.test(t) ? 'roth-401k' : '401k';
  if (/\bira\b|rollover/.test(t)) return 'ira';
  if (/credit/.test(t)) return 'credit';
  if (/cash management|checking/.test(t)) return 'checking';
  if (/saving|money market/.test(t)) return 'savings';
  if (/invest|brokerage|401|ira|retire/.test(t)) return 'brokerage';
  if (/loan|mortgage/.test(t)) return 'loan';
  return fallback;
}

/** An app account for an account in a file: one with the same last 4 digits, else the same name. */
export function accountFor(a: SourceAccount, accounts: Account[]): Account | undefined {
  const open = accounts.filter((x) => !x.archived);
  return (
    (a.last4 ? open.find((x) => x.last4 === a.last4) : undefined) ??
    open.find((x) => x.name.trim().toLowerCase() === a.name.trim().toLowerCase()) ??
    open.find((x) => !!a.institution && x.name.toLowerCase() === `${a.institution} ${a.name}`.toLowerCase())
  );
}

/** Where an account from a file goes: where it went last time, else a matching app account (or nothing yet). */
export function routeFor(a: SourceAccount, accounts: Account[], remembered: Record<string, string>): string | undefined {
  const last = remembered[a.ref ?? a.key];
  if (last === SKIP) return SKIP;
  if (last && accounts.some((x) => x.id === last && !x.archived)) return last;
  return accountFor(a, accounts)?.id;
}

const ACRONYMS = new Set(['IRA', 'HSA', 'TOD', 'JTWROS', 'WROS', 'UTMA', 'UGMA', 'SEP', 'CMA', 'LLC', 'ESA', '401K', '403B', '457', '529']);

/** "ROTH IRA" → "Roth IRA", "INDIVIDUAL - TOD" → "Individual - TOD"; names that aren't all capitals stay as they are. */
export function tidyName(name: string): string {
  if (/[a-z]/.test(name)) return name;
  return name.replace(/[A-Z0-9]+/g, (w) => (ACRONYMS.has(w) || /\d/.test(w) ? w : w[0] + w.slice(1).toLowerCase()));
}

/** A new app account for an account in a file: its name (with the bank's, when it isn't in it already) and type. */
export function newAccountFor(a: SourceAccount, fallback: AccountType = 'checking'): { name: string; type: AccountType; institution: string } {
  const name = tidyName(a.name);
  const institution = a.institution ?? '';
  return {
    name: institution && !name.toLowerCase().includes(institution.toLowerCase()) ? `${institution} ${name}` : name,
    type: accountTypeFor(a, fallback),
    institution,
  };
}
