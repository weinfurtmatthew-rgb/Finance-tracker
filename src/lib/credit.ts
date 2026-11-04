/**
 * Credit: your score over time, how much of your card limits you're using, and when to pay a card so
 * its statement reports a low balance.
 *
 * The app never checks your credit. You type your score in from wherever you see it (your bank or
 * card app, Credit Karma, Experian), and the log and your goal live in `meta`. Limits and statement
 * days are on each card.
 */
import type { Account, Cents, ISODate } from '../types';
import { addDays, dayInMonth, diffDays } from './dates';
import { balanceOn, type BalanceBook } from './networth';

export interface CreditScore {
  id: string;
  date: ISODate;
  score: number;
  /** Where you saw it: "Credit Karma", "My card's app"… */
  source?: string;
}

export interface CreditGoal {
  target: number;
  /** When you'd like to get there (optional). */
  by?: ISODate;
  /** Your score when you set it, where the progress bar starts. */
  from: number;
  setOn: ISODate;
}

/** Meta keys for the score log and the goal. */
export const CREDIT_SCORES = 'creditScores';
export const CREDIT_GOAL = 'creditGoal';

export const MIN_SCORE = 300;
export const MAX_SCORE = 850;
export const isScore = (n: number) => Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE;

/** FICO's ranges (VantageScore's are close). */
const BANDS = [
  { min: 800, name: 'Exceptional' },
  { min: 740, name: 'Very good' },
  { min: 670, name: 'Good' },
  { min: 580, name: 'Fair' },
  { min: 0, name: 'Poor' },
] as const;
export type CreditBand = (typeof BANDS)[number]['name'];
export const creditBand = (score: number): CreditBand => BANDS.find((b) => score >= b.min)!.name;

/** Oldest first. */
export const byDate = (scores: CreditScore[]) => [...scores].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** A score older than this says too little to use in Money Health or the calculators. */
export const SCORE_FRESH_DAYS = 365;
/** Today asks for a new score this long after the last one. */
export const SCORE_REMINDER_DAYS = 30;

/** Your latest score, if it's from the last year. */
export function currentScore(scores: CreditScore[], today: ISODate): CreditScore | undefined {
  const last = byDate(scores).at(-1);
  return last && diffDays(last.date, today) <= SCORE_FRESH_DAYS ? last : undefined;
}

/** Time for a new score: a month since the last one (only once you've started a log). */
export function scoreDue(scores: CreditScore[], today: ISODate): boolean {
  const last = byDate(scores).at(-1);
  return !!last && diffDays(last.date, today) >= SCORE_REMINDER_DAYS;
}

/** The change from the score before the latest one. */
export function lastChange(scores: CreditScore[]): { change: number; since: CreditScore } | undefined {
  const s = byDate(scores);
  if (s.length < 2) return undefined;
  return { change: s[s.length - 1].score - s[s.length - 2].score, since: s[s.length - 2] };
}

/** Over a period: from the last score before it (or the first in it) to the last one in it. */
export function scoreChangeIn(scores: CreditScore[], from: ISODate, to: ISODate): { start?: number; end: number; change?: number } | undefined {
  const s = byDate(scores);
  const inPeriod = s.filter((x) => x.date >= from && x.date <= to);
  if (!inPeriod.length) return undefined;
  const end = inPeriod[inPeriod.length - 1];
  const start = s.filter((x) => x.date < from).at(-1) ?? (inPeriod.length > 1 ? inPeriod[0] : undefined);
  return start ? { start: start.score, end: end.score, change: end.score - start.score } : { end: end.score };
}

// ---------------------------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------------------------

export interface GoalStatus {
  latest: number;
  toGo: number;
  /** 0–1 from where you started to the target. */
  progress: number;
  reached: boolean;
  /** Points a month over your scores from the last 6 months (needs two a month or more apart). */
  perMonth: number | null;
  /** When you'd get there at that pace. */
  eta?: ISODate;
  /** With a date to reach it by: whether that pace gets there in time. */
  onPace?: boolean;
}

export function goalStatus(goal: CreditGoal, scores: CreditScore[], today: ISODate): GoalStatus | null {
  const s = byDate(scores);
  const latest = s.at(-1);
  if (!latest) return null;
  const toGo = Math.max(0, goal.target - latest.score);
  const span = goal.target - goal.from;
  const progress = toGo === 0 ? 1 : span > 0 ? Math.min(1, Math.max(0, (latest.score - goal.from) / span)) : 0;
  const recent = s.filter((x) => x.date >= addDays(today, -183));
  const first = recent[0];
  const days = first ? diffDays(first.date, latest.date) : 0;
  const perMonth = days >= 30 ? (latest.score - first!.score) / (days / 30.44) : null;
  const eta = toGo > 0 && perMonth != null && perMonth > 0 ? addDays(latest.date, Math.ceil((toGo / perMonth) * 30.44)) : undefined;
  return {
    latest: latest.score,
    toGo,
    progress,
    reached: toGo === 0,
    perMonth,
    ...(eta ? { eta } : {}),
    ...(goal.by && toGo > 0 ? { onPace: !!eta && eta <= goal.by } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Card limits: utilization, and paying before a statement closes
// ---------------------------------------------------------------------------------------------

/** Reported balances under this share of your limits help a score most; under 30% is the usual advice. */
export const BEST_USE = 0.1;
export const OK_USE = 0.3;

export interface CardUse {
  account: Account;
  owed: Cents;
  limit: Cents;
  use: number;
}

export interface Utilization {
  cards: CardUse[];
  owed: Cents;
  limit: Cents;
  /** Across the cards with a limit; null when none has one. */
  use: number | null;
  /** Open cards without a limit entered. */
  withoutLimit: Account[];
}

export function utilization(accounts: Account[], book: BalanceBook): Utilization {
  const cards = accounts.filter((a) => a.type === 'credit' && !a.archived);
  const withLimit = cards
    .filter((a) => (a.creditLimit ?? 0) > 0)
    .map((a) => {
      const owed = Math.max(0, -balanceOn(book, a));
      return { account: a, owed, limit: a.creditLimit!, use: owed / a.creditLimit! };
    });
  const owed = withLimit.reduce((s, c) => s + c.owed, 0);
  const limit = withLimit.reduce((s, c) => s + c.limit, 0);
  return { cards: withLimit, owed, limit, use: limit > 0 ? owed / limit : null, withoutLimit: cards.filter((a) => !((a.creditLimit ?? 0) > 0)) };
}

/** The next day a card's statement closes, today or later (a short month closes on its last day). */
export function nextStatementClose(statementDay: number, today: ISODate): ISODate {
  const thisMonth = dayInMonth(today, 0, statementDay);
  return thisMonth >= today ? thisMonth : dayInMonth(today, 1, statementDay);
}

/** Today mentions a card this many days before its statement closes. */
export const STATEMENT_HEADS_UP_DAYS = 5;

export interface StatementPay extends CardUse {
  closes: ISODate;
  /** Paying this before the statement closes gets the reported balance under 10% of the limit. */
  pay: Cents;
}

/** Cards whose statement closes soon with more than 10% of the limit on them, and what to pay first. */
export function statementPayments(accounts: Account[], book: BalanceBook, today: ISODate): StatementPay[] {
  const out: StatementPay[] = [];
  for (const c of utilization(accounts, book).cards) {
    if (!c.account.statementDay) continue;
    const closes = nextStatementClose(c.account.statementDay, today);
    if (diffDays(today, closes) > STATEMENT_HEADS_UP_DAYS) continue;
    // In whole dollars, and not for a few dollars.
    const pay = Math.ceil((c.owed - Math.floor(c.limit * BEST_USE)) / 100) * 100;
    if (pay >= 1000) out.push({ ...c, closes, pay });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// What a score means elsewhere: typical rates, and landlords
// ---------------------------------------------------------------------------------------------

/**
 * Rough typical rates by credit range, a calculator's starting point when you haven't entered your
 * own: new credit card offers, and car or personal loans. Real offers vary by lender.
 */
const TYPICAL_APR: Record<'card' | 'loan', Record<CreditBand, number>> = {
  card: { Exceptional: 0.19, 'Very good': 0.2, Good: 0.22, Fair: 0.25, Poor: 0.28 },
  loan: { Exceptional: 0.055, 'Very good': 0.065, Good: 0.08, Fair: 0.12, Poor: 0.16 },
};
export const typicalApr = (kind: 'card' | 'loan', score: number) => TYPICAL_APR[kind][creditBand(score)];

/** Many landlords look for 620 to 650 or more. */
export function landlordCredit(score: number): { ok: boolean; text: string } {
  if (score >= 650) return { ok: true, text: 'Most landlords look for 650 or higher, so this should pass.' };
  if (score >= 620) return { ok: false, text: 'Many landlords look for 650 or higher; some accept this with a bigger deposit.' };
  return { ok: false, text: 'Below what most landlords look for (often 620 to 650), so a co-signer, guarantor or bigger deposit may be asked for.' };
}
