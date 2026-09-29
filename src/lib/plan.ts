/**
 * Financial calculators. Everything here is plain math on numbers the app already has, so the results
 * are estimates, not advice. Money is in cents; rates are yearly decimals (0.07 = 7%).
 */
import type { Cents } from '../types';

export const DEFAULT_RETURN = 0.07;
export const DEFAULT_INFLATION = 0.03;
export const DEFAULT_WITHDRAWAL_RATE = 0.04;

/** Monthly rate that compounds to the given yearly rate (APY or yearly return). */
export const monthlyRate = (yearly: number) => Math.pow(1 + yearly, 1 / 12) - 1;

/** Yearly rate in today's dollars ("real" return). */
export const realRate = (nominal: number, inflation: number) => (1 + nominal) / (1 + inflation) - 1;

/** Value today of an amount `years` from now, after inflation. */
export const inTodaysDollars = (cents: Cents, inflation: number, years: number) => Math.round(cents / Math.pow(1 + inflation, years));

/** Years to double at a yearly rate (the "Rule of 72" shortcut, and the exact figure). */
export function doublingYears(yearly: number): { rule72: number; exact: number } {
  return { rule72: 72 / (yearly * 100), exact: Math.log(2) / Math.log(1 + yearly) };
}

export interface GrowthPoint {
  year: number;
  balance: Cents;
  contributed: Cents;
  growth: Cents;
}

/**
 * Balance over time with a starting amount, a monthly contribution (added at the end of each month),
 * and a yearly rate compounded monthly. One point per year, starting at year 0.
 */
export function growth(start: Cents, monthly: Cents, yearly: number, years: number): GrowthPoint[] {
  const r = monthlyRate(yearly);
  const out: GrowthPoint[] = [{ year: 0, balance: start, contributed: start, growth: 0 }];
  let balance = start;
  let contributed = start;
  for (let m = 1; m <= Math.round(years * 12); m++) {
    balance = balance * (1 + r) + monthly;
    contributed += monthly;
    if (m % 12 === 0) out.push({ year: m / 12, balance: Math.round(balance), contributed, growth: Math.round(balance - contributed) });
  }
  return out;
}

/** Months until `target` is reached (null if never, within 100 years). */
export function monthsToReach(start: Cents, monthly: Cents, yearly: number, target: Cents): number | null {
  if (start >= target) return 0;
  const r = monthlyRate(yearly);
  let b = start;
  for (let m = 1; m <= 1200; m++) {
    b = b * (1 + r) + monthly;
    if (b >= target) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 1. Emergency fund / runway
// ---------------------------------------------------------------------------------------------

export interface Runway {
  months: number;
  target: Cents;
  gap: Cents;
  /** Months to close the gap at the given monthly saving (null if not saving). */
  monthsToTarget: number | null;
}

export function runway(cash: Cents, monthlySpending: Cents, targetMonths: number, monthlySaving: Cents): Runway {
  const months = monthlySpending > 0 ? cash / monthlySpending : Infinity;
  const target = Math.round(monthlySpending * targetMonths);
  const gap = Math.max(0, target - cash);
  return { months, target, gap, monthsToTarget: gap === 0 ? 0 : monthlySaving > 0 ? Math.ceil(gap / monthlySaving) : null };
}

// ---------------------------------------------------------------------------------------------
// 2. Can I afford it?
// ---------------------------------------------------------------------------------------------

/** Fixed monthly payment for a loan (standard amortization). */
export function loanPayment(principal: Cents, apr: number, months: number): Cents {
  if (months <= 0) return principal;
  const r = apr / 12;
  if (r === 0) return Math.round(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

export interface Affordability {
  upfront: Cents;
  monthlyPayment: Cents;
  totalInterest: Cents;
  cashAfter: Cents;
  runwayBefore: number;
  runwayAfter: number;
  leftAfterBillsAfter?: Cents;
  surplusAfter: Cents;
  /** What the upfront money could grow to if invested instead. */
  opportunity: { years: number; value: Cents }[];
  verdict: 'comfortable' | 'tight' | 'stretch';
  reasons: string[];
}

export function affordability(args: {
  price: Cents;
  financed: boolean;
  downPayment: Cents;
  apr: number;
  months: number;
  cash: Cents;
  monthlySpending: Cents;
  monthlySurplus: Cents;
  leftAfterBills?: Cents;
  returnRate: number;
}): Affordability {
  const upfront = args.financed ? Math.min(args.price, args.downPayment) : args.price;
  const principal = args.price - upfront;
  const monthlyPayment = args.financed && principal > 0 ? loanPayment(principal, args.apr, args.months) : 0;
  const totalInterest = args.financed && principal > 0 ? monthlyPayment * args.months - principal : 0;
  const cashAfter = args.cash - upfront;
  const spend = Math.max(1, args.monthlySpending);
  const runwayBefore = args.cash / spend;
  const runwayAfter = cashAfter / (spend + monthlyPayment);
  const surplusAfter = args.monthlySurplus - monthlyPayment;
  const leftAfterBillsAfter = args.leftAfterBills != null ? args.leftAfterBills - upfront : undefined;
  const opportunity = [5, 10, 20].map((years) => ({ years, value: growth(upfront, 0, args.returnRate, years).at(-1)!.balance }));

  const reasons: string[] = [];
  let score = 0;
  if (cashAfter < 0) {
    reasons.push("You don't have enough cash for the upfront cost.");
    score += 3;
  } else if (runwayAfter < 1) {
    reasons.push('Less than a month of spending would be left in cash.');
    score += 2;
  } else if (runwayAfter < 3) {
    reasons.push('Your cash cushion would drop below 3 months of spending.');
    score += 1;
  }
  if (leftAfterBillsAfter != null && leftAfterBillsAfter < 0) {
    reasons.push("You'd be short for bills due before your next payday.");
    score += 2;
  }
  if (monthlyPayment > 0 && surplusAfter < 0) {
    reasons.push('The monthly payment is more than you usually have left over each month.');
    score += 2;
  } else if (monthlyPayment > 0 && args.monthlySurplus > 0 && monthlyPayment > args.monthlySurplus * 0.5) {
    reasons.push('The payment would use more than half of what you usually save each month.');
    score += 1;
  }
  if (!reasons.length) reasons.push('Your cash cushion and monthly budget stay healthy.');
  return {
    upfront,
    monthlyPayment,
    totalInterest,
    cashAfter,
    runwayBefore,
    runwayAfter,
    leftAfterBillsAfter,
    surplusAfter,
    opportunity,
    verdict: score >= 2 ? 'stretch' : score === 1 ? 'tight' : 'comfortable',
    reasons,
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Debt payoff: avalanche vs snowball
// ---------------------------------------------------------------------------------------------

export interface Debt {
  id: string;
  name: string;
  balance: Cents;
  /** Yearly rate, e.g. 0.2499. */
  apr: number;
  minPayment: Cents;
}

export interface PayoffResult {
  strategy: 'avalanche' | 'snowball';
  months: number;
  totalInterest: Cents;
  /** Month each debt is paid off (1 = next month), in payoff order. */
  order: { id: string; name: string; month: number }[];
  /** Total balance left after each month (for charting). */
  remaining: Cents[];
  /** The payments can't keep up with the interest. */
  neverPaidOff: boolean;
}

/**
 * Every month: interest is added, every debt gets its minimum, and everything else (the extra plus
 * the minimums freed up by debts already paid off) goes to the target debt: highest APR first
 * (avalanche) or smallest balance first (snowball).
 */
export function payoff(debts: Debt[], extra: Cents, strategy: 'avalanche' | 'snowball'): PayoffResult {
  const ds = debts.filter((d) => d.balance > 0).map((d) => ({ ...d, bal: d.balance, paidMonth: 0 }));
  const budget = ds.reduce((s, d) => s + d.minPayment, 0) + extra;
  const order: PayoffResult['order'] = [];
  const remaining: Cents[] = [];
  let totalInterest = 0;
  let month = 0;
  const rank = (a: (typeof ds)[number], b: (typeof ds)[number]) => (strategy === 'avalanche' ? b.apr - a.apr || a.bal - b.bal : a.bal - b.bal || b.apr - a.apr);
  while (ds.some((d) => d.bal > 0) && month < 600) {
    month++;
    for (const d of ds) {
      if (d.bal <= 0) continue;
      const interest = Math.round((d.bal * d.apr) / 12);
      d.bal += interest;
      totalInterest += interest;
    }
    let left = budget;
    for (const d of ds) {
      if (d.bal <= 0) continue;
      const pay = Math.min(d.bal, d.minPayment, left);
      d.bal -= pay;
      left -= pay;
    }
    for (const d of [...ds].filter((x) => x.bal > 0).sort(rank)) {
      if (left <= 0) break;
      const pay = Math.min(d.bal, left);
      d.bal -= pay;
      left -= pay;
    }
    for (const d of ds) {
      if (d.bal <= 0 && !d.paidMonth) {
        d.paidMonth = month;
        order.push({ id: d.id, name: d.name, month });
      }
    }
    remaining.push(ds.reduce((s, d) => s + Math.max(0, d.bal), 0));
  }
  const neverPaidOff = ds.some((d) => d.bal > 0);
  return { strategy, months: month, totalInterest, order, remaining, neverPaidOff };
}

// ---------------------------------------------------------------------------------------------
// 4. True cost of a habit
// ---------------------------------------------------------------------------------------------

export function trueCost(monthly: Cents, yearly: number, years: number[]): { years: number; spent: Cents; invested: Cents }[] {
  return years.map((y) => ({ years: y, spent: monthly * 12 * y, invested: growth(0, monthly, yearly, y).at(-1)!.balance }));
}

// ---------------------------------------------------------------------------------------------
// 5. Financial independence & "will my money last?"
// ---------------------------------------------------------------------------------------------

export interface FiPlan {
  /** Investments needed to cover yearly spending at the withdrawal rate (today's dollars). */
  target: Cents;
  savingsRate: number;
  /** Years until investments reach the target, growing at the real (after-inflation) return. */
  years: number | null;
}

export function fiPlan(args: { annualSpending: Cents; invested: Cents; monthlyInvesting: Cents; monthlyIncome: Cents; nominalReturn: number; inflation: number; withdrawalRate: number }): FiPlan {
  const target = Math.round(args.annualSpending / args.withdrawalRate);
  const months = monthsToReach(args.invested, args.monthlyInvesting, realRate(args.nominalReturn, args.inflation), target);
  return {
    target,
    savingsRate: args.monthlyIncome > 0 ? args.monthlyInvesting / args.monthlyIncome : 0,
    years: months == null ? null : months / 12,
  };
}

/** Small, fast, seeded random numbers so simulations are repeatable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationResult {
  /** Share of simulated markets where the money lasted the whole time. */
  successRate: number;
  /** Ending balance (today's dollars) at the 10th, 50th and 90th percentile. */
  ending: { p10: Cents; p50: Cents; p90: Cents };
  /** Median balance per year (today's dollars), for charting. */
  medianPath: Cents[];
  /** When it runs out in the bad cases: the 10th-percentile year money ran out (null if it never does). */
  runsOutYearP10: number | null;
}

/**
 * Monte Carlo: `runs` random market histories. Each year the portfolio earns a random return (normal,
 * mean `meanReturn`, standard deviation `volatility`), then the inflation-adjusted withdrawal comes out.
 * Everything is reported in today's dollars.
 */
export function simulateRetirement(args: {
  balance: Cents;
  annualWithdrawal: Cents;
  years: number;
  meanReturn: number;
  volatility: number;
  inflation: number;
  runs?: number;
  seed?: number;
}): SimulationResult {
  const runs = args.runs ?? 1000;
  const rand = mulberry32(args.seed ?? 42);
  const normal = () => {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const endings: number[] = [];
  const paths: number[][] = Array.from({ length: args.years + 1 }, () => []);
  const ranOut: number[] = [];
  let lasted = 0;
  for (let i = 0; i < runs; i++) {
    let bal = args.balance;
    let infl = 1;
    let out = 0;
    paths[0].push(bal);
    for (let y = 1; y <= args.years; y++) {
      bal *= 1 + args.meanReturn + args.volatility * normal();
      infl *= 1 + args.inflation;
      bal -= args.annualWithdrawal * infl;
      if (bal <= 0) {
        bal = 0;
        if (!out) out = y;
      }
      paths[y].push(bal / infl);
    }
    if (!out) lasted++;
    else ranOut.push(out);
    endings.push(bal / infl);
  }
  const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    successRate: lasted / runs,
    ending: { p10: Math.round(pct(endings, 0.1)), p50: Math.round(pct(endings, 0.5)), p90: Math.round(pct(endings, 0.9)) },
    medianPath: paths.map((p) => Math.round(pct(p, 0.5))),
    runsOutYearP10: ranOut.length >= runs * 0.1 ? pct(ranOut.concat(Array(lasted).fill(Infinity)), 0.1) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Savings APY estimate from your own "interest paid" transactions
// ---------------------------------------------------------------------------------------------

/**
 * Yearly yield implied by interest received over a period, relative to the average balance.
 * `months` is how long the interest covers. Returns null when there's too little to go on.
 */
export function estimateApy(interest: Cents, averageBalance: Cents, months: number): number | null {
  if (interest <= 0 || averageBalance <= 0 || months < 1) return null;
  const monthly = interest / averageBalance / months;
  return Math.pow(1 + monthly, 12) - 1;
}
