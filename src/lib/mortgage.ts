/**
 * The mortgage calculator: a home's monthly cost (principal and interest, property tax, insurance, PMI
 * and HOA), what the loan costs in interest, how paying extra shortens it, and the price that fits a
 * monthly budget. Payments are standard fixed-rate amortization, month by month.
 */
import type { Cents } from '../types';
import { loanPayment } from './plan';

export interface MortgageInputs {
  price: Cents;
  down: Cents;
  /** Yearly interest rate (0.065 for 6.5%). */
  rate: number;
  years: number;
  /** Property tax a year, as a share of the price. */
  taxRate: number;
  /** Home insurance a year. */
  insurance: Cents;
  /** HOA dues a month. */
  hoa: Cents;
  /** PMI a year as a share of the loan, while the down payment is under 20%. */
  pmiRate: number;
  /** Extra toward principal each month. */
  extra: Cents;
}

export interface Mortgage {
  loan: Cents;
  /** The down payment's share of the price. */
  downShare: number;
  principalAndInterest: Cents;
  tax: Cents;
  insurance: Cents;
  hoa: Cents;
  /** PMI a month while it's charged, and for how many months (it stops at 78% of the price). */
  pmi: Cents;
  pmiMonths: number;
  /** Everything, the first month. */
  monthly: Cents;
  /** Months to pay it off, and the interest paid in all (with the extra). */
  months: number;
  totalInterest: Cents;
  /** The same without the extra, to compare. */
  baseMonths: number;
  baseInterest: Cents;
  /** What's still owed at the end of each year (index 0 is the start). */
  balances: Cents[];
}

/** PMI stops once the balance reaches this share of the price (what lenders must do on schedule). */
export const PMI_ENDS = 0.78;
/** Under this down payment, lenders charge PMI. */
export const PMI_BELOW = 0.2;

/** Pays the loan off month by month: how long it takes, the interest, PMI months and yearly balances. */
function amortize(loan: Cents, rate: number, payment: Cents, extra: Cents, pmiUntil: Cents, term: number) {
  const r = rate / 12;
  let balance = loan;
  let months = 0;
  let interest = 0;
  let pmiMonths = 0;
  const balances: Cents[] = [loan];
  while (balance > 0 && months < term) {
    if (balance > pmiUntil) pmiMonths++;
    const owed = Math.round(balance * r);
    interest += owed;
    balance = Math.max(0, balance + owed - payment - extra);
    months++;
    // The last scheduled payment takes what rounding left over, as lenders do.
    if (months === term) balance = 0;
    if (months % 12 === 0) balances.push(balance);
  }
  if (months % 12 !== 0) balances.push(balance);
  return { months, interest, pmiMonths, balances };
}

export function mortgage(i: MortgageInputs): Mortgage {
  const down = Math.min(Math.max(0, i.down), i.price);
  const loan = i.price - down;
  const n = Math.max(1, Math.round(i.years * 12));
  const principalAndInterest = loan > 0 ? loanPayment(loan, i.rate, n) : 0;
  const downShare = i.price > 0 ? down / i.price : 0;
  const pmi = loan > 0 && downShare < PMI_BELOW ? Math.round((loan * i.pmiRate) / 12) : 0;
  const pmiUntil = pmi > 0 ? Math.round(i.price * PMI_ENDS) : Infinity;
  const tax = Math.round((i.price * i.taxRate) / 12);
  const insurance = Math.round(i.insurance / 12);
  const paid = amortize(loan, i.rate, principalAndInterest, Math.max(0, i.extra), pmiUntil, n);
  const base = i.extra > 0 ? amortize(loan, i.rate, principalAndInterest, 0, pmiUntil, n) : paid;
  return {
    loan,
    downShare,
    principalAndInterest,
    tax,
    insurance,
    hoa: i.hoa,
    pmi,
    pmiMonths: pmi > 0 ? paid.pmiMonths : 0,
    monthly: principalAndInterest + tax + insurance + i.hoa + pmi,
    months: paid.months,
    totalInterest: paid.interest,
    baseMonths: base.months,
    baseInterest: base.interest,
    balances: paid.balances,
  };
}

/** The highest price whose first month costs `budget` or less, with the down payment the same share of it. */
export function priceThatFits(i: Omit<MortgageInputs, 'price' | 'down'>, downShare: number, budget: Cents): Cents {
  if (budget <= 0) return 0;
  const cost = (price: Cents) => mortgage({ ...i, price, down: Math.round(price * downShare) }).monthly - i.hoa;
  let lo = 0;
  let hi = 100_000;
  const room = budget - i.hoa;
  if (room <= 0) return 0;
  while (cost(hi) <= room && hi < 1e12) hi *= 2;
  while (hi - lo > 100_00) {
    const mid = Math.floor((lo + hi) / 2);
    if (cost(mid) <= room) lo = mid;
    else hi = mid;
  }
  // To the nearest $1,000 below.
  return Math.floor(lo / 100_000) * 100_000;
}
