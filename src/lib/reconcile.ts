/**
 * Balance check: compare the app's balance for an account with the one your bank shows, and when they
 * differ, point at the likely reasons (and the fix for each).
 */
import type { Account, Cents, ISODate, Transaction } from '../types';
import { accountBalance, isLiability } from './balances';
import { addDays, diffDays } from './dates';
import { payeeKey } from './categorize';

export interface DuplicatePair {
  keep: Transaction;
  extra: Transaction;
}

export interface Reconciliation {
  /** Balance as your bank shows it (amount owed is positive for cards and loans). */
  appBalance: Cents;
  bankBalance: Cents;
  /** App minus bank, as shown: positive = the app shows more money (or less owed) than the bank. */
  difference: Cents;
  matches: boolean;
  /** Probably the same transaction imported twice (e.g. once while pending, once posted). */
  duplicates: DuplicatePair[];
  /** Removing the suspected duplicates would make the balances match exactly. */
  duplicatesExplain: boolean;
  /** Days with no transactions where there usually are some: a file probably wasn't imported. */
  gap?: { from: ISODate; to: ISODate };
  /** The bank has more going out than the app: most likely charges still pending when you exported. */
  pendingLikely: boolean;
  /** The account's balance was never checked, so its starting balance may simply be missing. */
  neverChecked: boolean;
}

/** Same first word of the payee, e.g. "Starbucks" vs "Starbucks Store 1234". */
const samePayee = (a: Transaction, b: Transaction) => {
  const [x, y] = [payeeKey(a.payee), payeeKey(b.payee)];
  return x === y || (x.split(' ')[0] === y.split(' ')[0] && x.split(' ')[0].length >= 3);
};

/**
 * Two rows the bank itself says are different: identical rows in one CSV file (two $5 coffees the same
 * day get ids ending :0 and :1), or two OFX rows, which carry the bank's own unique ids.
 */
function bankSaysDistinct(a: Transaction, b: Transaction): boolean {
  if (!a.importId || !b.importId) return false;
  if (a.importId.includes(':ofx:') && b.importId.includes(':ofx:')) return true;
  const base = (id: string) => id.slice(0, id.lastIndexOf(':'));
  return base(a.importId) === base(b.importId);
}

/**
 * Pairs that look like one purchase entered twice: same amount, within 3 days, similar payee, and not two
 * rows the bank itself lists separately. Typical cases: a charge exported while pending and again once
 * posted (the description changes), or a purchase typed in by hand that later arrives in a bank file.
 */
export function findDuplicates(txns: Transaction[]): DuplicatePair[] {
  const byAmount = new Map<Cents, Transaction[]>();
  for (const t of txns) byAmount.set(t.amount, [...(byAmount.get(t.amount) ?? []), t]);
  const pairs: DuplicatePair[] = [];
  const used = new Set<string>();
  for (const list of byAmount.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (used.has(a.id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (used.has(b.id) || diffDays(a.date, b.date) > 3) continue;
        if (bankSaysDistinct(a, b) || !samePayee(a, b)) continue;
        // Keep the imported one over a hand-entered one, then the older one.
        const [keep, extra] = a.source === 'manual' && b.source !== 'manual' ? [b, a] : [a, b];
        pairs.push({ keep, extra });
        used.add(a.id).add(b.id);
        break;
      }
    }
  }
  return pairs;
}

/** The longest stretch without transactions in the last `window` days, if it's unusually long. */
export function findGap(txns: Transaction[], today: ISODate, window = 120): { from: ISODate; to: ISODate } | undefined {
  const since = addDays(today, -window);
  const dates = [...new Set(txns.map((t) => t.date))].filter((d) => d >= since).sort();
  if (dates.length < 6) return undefined;
  const gaps = dates.slice(1).map((d, i) => ({ from: dates[i], to: d, days: diffDays(dates[i], d) }));
  const typical = [...gaps].sort((a, b) => a.days - b.days)[Math.floor(gaps.length / 2)].days;
  const worst = gaps.sort((a, b) => b.days - a.days)[0];
  // A gap of 3 weeks in an account that normally has activity every few days.
  return worst.days >= 21 && worst.days >= typical * 5 ? { from: addDays(worst.from, 1), to: addDays(worst.to, -1) } : undefined;
}

export function reconcile(args: { account: Account; txns: Transaction[]; bankBalance: Cents; today: ISODate }): Reconciliation {
  const { account, bankBalance, today } = args;
  const own = args.txns.filter((t) => t.accountId === account.id);
  const sign = isLiability(account) ? -1 : 1;
  const appBalance = sign * accountBalance(account, own);
  const difference = appBalance - bankBalance;
  const duplicates = difference ? findDuplicates(own) : [];
  // Removing a duplicate takes its amount back out of the balance.
  const withoutDupes = appBalance - sign * duplicates.reduce((s, p) => s + p.extra.amount, 0);
  return {
    appBalance,
    bankBalance,
    difference,
    matches: difference === 0,
    duplicates,
    duplicatesExplain: duplicates.length > 0 && withoutDupes === bankBalance,
    gap: difference ? findGap(own, today) : undefined,
    // For a never-checked account the missing starting balance explains it; don't guess further.
    pendingLikely: difference > 0 && !!account.checkedOn,
    neverChecked: !account.checkedOn,
  };
}

/**
 * What "Match my bank" does. An account never checked before just gets the right starting balance;
 * after that, the difference is recorded as a dated adjustment so history stays honest.
 */
export function matchBank(account: Account, r: Reconciliation): { openingBalance?: Cents; adjustment?: Cents } {
  const signed = (isLiability(account) ? -1 : 1) * -r.difference;
  return r.neverChecked ? { openingBalance: account.openingBalance + signed } : { adjustment: signed };
}
