/**
 * The numbers the calculators start from, taken from your own data: cash on hand, typical monthly
 * spending and income, investments, debts and what your savings actually earn. Every value can be
 * overridden in the calculator, and each one says where it came from.
 */
import type { Account, Cents, ISODate, Transaction } from '../types';
import { addMonths, dayInMonth, monthKey } from './dates';
import { balanceOn, type BalanceBook } from './networth';
import type { MonthSpending } from './budgets';
import { estimateApy, type Debt } from './plan';

/** Typical rates used when an account doesn't have its own (shown as estimates). */
export const TYPICAL_CARD_APR = 0.22;
export const TYPICAL_LOAN_APR = 0.07;

export interface PlanDebt extends Debt {
  /** The APR / minimum was guessed, not entered on the account. */
  aprEstimated: boolean;
  minEstimated: boolean;
}

export interface PlanSnapshot {
  /** Checking + savings + cash accounts. */
  cash: Cents;
  savings: Cents;
  /** What goes into savings accounts in a typical month (deposits minus withdrawals, not interest). */
  savingsMonthly: Cents;
  /** Investment account values. */
  invested: Cents;
  /** Average spending (everyday + bills) per month over the months averaged. */
  monthlySpending: Cents;
  /** The bills-and-subscriptions part of monthly spending (the bare minimum). */
  monthlyFixed: Cents;
  monthlyIncome: Cents;
  monthlySurplus: Cents;
  /** Full months the averages are based on, e.g. ['2026-06', '2026-07', '2026-08']. */
  averagedMonths: string[];
  debts: PlanDebt[];
  /** Yearly yield on savings: typed on the account, estimated from interest received, or unknown. */
  apy: number | null;
  apySource: 'account' | 'interest' | null;
}

/**
 * A card's minimum payment when none is entered: interest plus 1% of the balance, at least $25
 * (the common US formula). Loans default to paying off in 5 years.
 */
export function estimateMinPayment(a: Pick<Account, 'type'>, balance: Cents, apr: number): Cents {
  if (balance <= 0) return 0;
  if (a.type === 'loan') {
    const r = apr / 12;
    return Math.round(r ? (balance * r) / (1 - Math.pow(1 + r, -60)) : balance / 60);
  }
  return Math.min(balance, Math.max(2500, Math.round(balance * 0.01 + (balance * apr) / 12)));
}

export function planSnapshot(args: {
  accounts: Account[];
  book: BalanceBook;
  txns: Transaction[];
  months: Map<string, MonthSpending>;
  today: ISODate;
}): PlanSnapshot {
  const { book, txns, months, today } = args;
  const open = args.accounts.filter((a) => !a.archived);
  const sum = (types: Account['type'][]) => open.filter((a) => types.includes(a.type)).reduce((s, a) => s + balanceOn(book, a), 0);

  // Averages over the last 3 full months that have any activity (fewer if that's all there is).
  const current = monthKey(today);
  const averagedMonths: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const k = addMonths(current, -i);
    const m = months.get(k);
    if (m && (m.flexible || m.fixed || m.income)) averagedMonths.unshift(k);
  }
  const avg = (f: (m: MonthSpending) => Cents) =>
    averagedMonths.length ? Math.round(averagedMonths.reduce((s, k) => s + f(months.get(k)!), 0) / averagedMonths.length) : 0;
  const monthlySpending = Math.max(
    0,
    avg((m) => m.flexible + m.fixed),
  );
  const monthlyFixed = Math.max(
    0,
    avg((m) => m.fixed),
  );
  const monthlyIncome = Math.max(
    0,
    avg((m) => m.income),
  );

  const savingsIds = new Set(open.filter((a) => a.type === 'savings').map((a) => a.id));
  const inAveraged = new Set(averagedMonths);
  const savingsMonthly = averagedMonths.length
    ? Math.max(
        0,
        Math.round(
          txns
            .filter((t) => savingsIds.has(t.accountId) && t.categoryId !== 'interest' && inAveraged.has(monthKey(t.date)))
            .reduce((s, t) => s + t.amount, 0) / averagedMonths.length,
        ),
      )
    : 0;

  const debts: PlanDebt[] = open
    .filter((a) => a.type === 'credit' || a.type === 'loan')
    .map((a) => {
      const balance = -balanceOn(book, a);
      const apr = a.apr ?? (a.type === 'loan' ? TYPICAL_LOAN_APR : TYPICAL_CARD_APR);
      return {
        id: a.id,
        name: a.name,
        balance,
        apr,
        minPayment: a.minPayment ?? estimateMinPayment(a, balance, apr),
        aprEstimated: a.apr == null,
        minEstimated: a.minPayment == null,
      };
    })
    .filter((d) => d.balance > 0);

  // Savings APY: a rate typed on a savings account wins (balance-weighted); otherwise estimate it from
  // the last 12 months of interest received into savings accounts.
  const savingsAccts = open.filter((a) => a.type === 'savings');
  let apy: number | null = null;
  let apySource: PlanSnapshot['apySource'] = null;
  const typed = savingsAccts.filter((a) => a.apy != null);
  if (typed.length) {
    const weights = typed.map((a) => Math.max(1, balanceOn(book, a)));
    const total = weights.reduce((s, w) => s + w, 0);
    apy = typed.reduce((s, a, i) => s + a.apy! * weights[i], 0) / total;
    apySource = 'account';
  } else if (savingsAccts.length) {
    const ids = new Set(savingsAccts.map((a) => a.id));
    const since = dayInMonth(today, -12, 1);
    const interestTxns = txns.filter((t) => ids.has(t.accountId) && t.categoryId === 'interest' && t.amount > 0 && t.date >= since);
    if (interestTxns.length) {
      const first = interestTxns.reduce((m, t) => (t.date < m ? t.date : m), today);
      // Interest usually arrives monthly, so n payments cover about n months.
      const monthsCovered = Math.max(1, new Set(interestTxns.map((t) => monthKey(t.date))).size);
      const ends = Array.from({ length: monthsCovered }, (_, i) => dayInMonth(first, i, 31));
      const avgBalance = ends.reduce((s, d) => s + savingsAccts.reduce((x, a) => x + balanceOn(book, a, d), 0), 0) / ends.length;
      apy = estimateApy(
        interestTxns.reduce((s, t) => s + t.amount, 0),
        avgBalance,
        monthsCovered,
      );
      if (apy != null) apySource = 'interest';
    }
  }

  return {
    cash: sum(['checking', 'savings', 'cash', 'wallet']),
    savings: sum(['savings']),
    savingsMonthly,
    invested: sum(['brokerage']),
    monthlySpending,
    monthlyFixed,
    monthlyIncome,
    monthlySurplus: monthlyIncome - monthlySpending,
    averagedMonths,
    debts,
    apy,
    apySource,
  };
}
