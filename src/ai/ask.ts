/**
 * "Ask about your money": a question is turned into a structured query (by simple rules, or by the
 * on-device language model when the rules don't understand it), and the app then computes the answer
 * from your data. The model never produces numbers itself.
 */
import type { Category, Cents, ISODate, Transaction } from '../types';
import { addDays, addMonths, dayInMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { FREQUENCIES, monthlyCost, type RecurringStatus } from '../lib/recurring';
import type { BudgetProgress } from '../lib/budgets';

export const INTENTS = ['spending', 'income', 'top_categories', 'top_merchants', 'subscriptions', 'net_worth', 'budget', 'largest', 'count'] as const;
export type Intent = (typeof INTENTS)[number];

export interface Period {
  from: ISODate;
  to: ISODate;
  label: string;
}

export interface Query {
  intent: Intent;
  categoryId?: string;
  merchant?: string;
  period: Period;
  source: 'rules' | 'ai';
}

export interface AskContext {
  today: ISODate;
  categories: Category[];
  /** Known payee names, for recognizing merchants in questions. */
  merchants: string[];
}

// ---------------------------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

export function monthPeriod(month: string, today: ISODate): Period {
  const from = `${month}-01`;
  const end = dayInMonth(from, 0, 31);
  return { from, to: end < today ? end : today, label: monthLabel(month) };
}

export function thisMonth(today: ISODate): Period {
  return { ...monthPeriod(monthKey(today), today), label: 'this month' };
}

export function parsePeriod(text: string, today: ISODate): Period | null {
  const t = ` ${text.toLowerCase()} `;
  const year = Number(today.slice(0, 4));
  const current = monthKey(today);
  let m: RegExpMatchArray | null;
  if (/\btoday\b/.test(t)) return { from: today, to: today, label: 'today' };
  if (/\byesterday\b/.test(t)) {
    const y = addDays(today, -1);
    return { from: y, to: y, label: 'yesterday' };
  }
  if (/\b(this|current) week\b/.test(t)) {
    const dow = (new Date(`${today}T12:00`).getDay() + 6) % 7; // Monday = 0
    return { from: addDays(today, -dow), to: today, label: 'this week' };
  }
  if (/\blast week\b/.test(t)) {
    const dow = (new Date(`${today}T12:00`).getDay() + 6) % 7;
    const monday = addDays(today, -dow - 7);
    return { from: monday, to: addDays(monday, 6), label: 'last week' };
  }
  if ((m = t.match(/\b(?:last|past|previous)\s+(\d+|[a-z]+)\s+days?\b/)) && (Number(m[1]) || NUM_WORDS[m[1]])) {
    const n = Number(m[1]) || NUM_WORDS[m[1]];
    return { from: addDays(today, -(n - 1)), to: today, label: `the last ${n} days` };
  }
  if ((m = t.match(/\b(?:last|past|previous)\s+(\d+|[a-z]+)\s+months?\b/)) && (Number(m[1]) || NUM_WORDS[m[1]])) {
    const n = Number(m[1]) || NUM_WORDS[m[1]];
    return { from: `${addMonths(current, -n)}-01`, to: dayInMonth(`${addMonths(current, -1)}-01`, 0, 31), label: `the last ${n} full months` };
  }
  if (/\b(this|current) month\b|\bmonth to date\b|\bso far this month\b/.test(t)) return thisMonth(today);
  if (/\b(last|previous) month\b/.test(t)) return monthPeriod(addMonths(current, -1), today);
  if (/\b(this year|year to date|ytd)\b/.test(t)) return { from: `${year}-01-01`, to: today, label: 'this year' };
  if (/\blast year\b/.test(t)) return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, label: String(year - 1) };
  if ((m = t.match(/\b(?:in|during|for)\s+(20\d\d)\b/)) && !MONTHS.some((mo) => t.includes(mo))) {
    const y = Number(m[1]);
    return { from: `${y}-01-01`, to: y === year ? today : `${y}-12-31`, label: String(y) };
  }
  // Month names: "in August", "aug 2025", "since March".
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`\\b(since\\s+)?(${MONTHS[i]}|${MONTHS[i].slice(0, 3)})\\b\\.?(?:\\s+(20\\d\\d))?`);
    const hit = t.match(re);
    if (!hit || (MONTHS[i] === 'may' && !/\b(in|since|during|for|of)\s+may\b|\bmay\s+20\d\d\b/.test(t))) continue;
    let y = hit[3] ? Number(hit[3]) : year;
    const month = `${y}-${String(i + 1).padStart(2, '0')}`;
    if (!hit[3] && month > current) y -= 1; // "in December" asked in September means last December
    const key = `${y}-${String(i + 1).padStart(2, '0')}`;
    if (hit[1]) return { from: `${key}-01`, to: today, label: `since ${monthLabel(key)}` };
    return monthPeriod(key, today);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Rule-based understanding
// ---------------------------------------------------------------------------------------------

const CATEGORY_WORDS: Record<string, string[]> = {
  dining: ['dining', 'restaurant', 'restaurants', 'eating out', 'eat out', 'takeout', 'take out', 'take-out', 'coffee', 'fast food', 'food delivery'],
  groceries: ['grocery', 'groceries', 'supermarket', 'supermarkets'],
  gas: ['gas', 'fuel', 'gasoline'],
  transport: ['transportation', 'transport', 'rides', 'rideshare', 'parking', 'tolls', 'transit'],
  shopping: ['shopping', 'clothes', 'clothing'],
  bills: ['bills', 'utilities', 'utility', 'electric', 'electricity', 'internet', 'phone bill'],
  housing: ['rent', 'mortgage', 'housing'],
  entertainment: ['entertainment', 'movies', 'concerts', 'games', 'fun'],
  health: ['health', 'medical', 'doctor', 'doctors', 'pharmacy', 'gym', 'fitness'],
  travel: ['travel', 'trips', 'trip', 'flights', 'hotels', 'vacation'],
  personal: ['personal care', 'haircut', 'haircuts', 'salon'],
  education: ['education', 'school', 'tuition'],
  gifts: ['gifts', 'donations', 'charity'],
  insurance: ['insurance'],
  fees: ['fees', 'bank fees', 'interest charges'],
};

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);
}

export function findCategory(text: string, categories: Category[]): string | undefined {
  const t = text.toLowerCase();
  let best: { id: string; len: number } | undefined;
  for (const c of categories) {
    if (c.group === 'transfer') continue;
    const words = [c.name.toLowerCase(), ...(CATEGORY_WORDS[c.id] ?? [])];
    for (const w of words) if (containsPhrase(t, w) && (!best || w.length > best.len)) best = { id: c.id, len: w.length };
  }
  return best?.id;
}

export function findMerchant(text: string, merchants: string[]): string | undefined {
  const t = text.toLowerCase();
  let best: string | undefined;
  for (const m of merchants) {
    const name = m.toLowerCase().trim();
    if (name.length < 3) continue;
    // Match the full name, or its distinctive first word ("starbucks" for "Starbucks Coffee").
    const first = name.split(/\s+/)[0].replace(/'s$/, '');
    if (containsPhrase(t, name) || (first.length >= 4 && containsPhrase(t, first))) {
      if (!best || name.length > best.length) best = m;
    }
  }
  return best;
}

/**
 * Rule-based intent. "strong" matches are unambiguous phrasings; "weak" ones are loose keywords
 * ("paycheck", "blow", "money in") that the AI gets to overrule when it's on.
 */
export function detectIntentWithStrength(text: string): { intent: Intent; strong: boolean } | null {
  const t = text.toLowerCase();
  const strong = (intent: Intent) => ({ intent, strong: true });
  const weak = (intent: Intent) => ({ intent, strong: false });
  if (/net ?worth|how much am i worth|what am i worth/.test(t)) return strong('net_worth');
  if (/subscription|recurring|streaming|membership|what bills|which bills|my bills/.test(t)) return strong('subscriptions');
  if (/budget|left to spend|over(spent| budget)|\blimits?\b/.test(t)) return strong('budget');
  if (/(biggest|largest|most expensive|highest|priciest)\s+(single\s+)?(purchase|transaction|expense|charge|payment|thing|item)s?|(priciest|most expensive) (thing|item|purchase)/.test(t)) return strong('largest');
  if (/how many times|how often|number of (times|visits|purchases|transactions)/.test(t)) return strong('count');
  const spendWord = /\b(spend|spent|spending)\b/.test(t);
  if (/\b(income|earn|earned|salary|got paid|came in|come in)\b/.test(t) && !spendWord) return strong('income');
  if (/categor|where (did|does|do) (my |all )?(the )?money go|where.*spending go|what (did|do) i (spend|splurge|blow|blew)\b.*\bmost\b|splurge/.test(t)) return strong('top_categories');
  if (/(merchant|store|stores|shop|shops|places|place|companies|company)\b.*(most|top|biggest)|(most|top|biggest).*(merchant|store|shop|place|companies)|where do i (shop|spend) (the )?most/.test(t))
    return strong('top_merchants');
  if (spendWord || /\b(expenses?|cost|costs)\b/.test(t)) return strong('spending');
  if (/\b(made|make|paid me|paycheck|money in|deposited)\b/.test(t)) return weak('income');
  if (/\b(pay|paid|drop|dropped|blow|blew|shell(ed)? out)\b/.test(t)) return weak('spending');
  return null;
}

export function detectIntent(text: string): Intent | null {
  return detectIntentWithStrength(text)?.intent ?? null;
}

/** Understand a question with rules. Returns null when unsure (then the AI model gets a try). */
export function parseQuestion(text: string, ctx: AskContext): Query | null {
  const category = findCategory(text, ctx.categories);
  const merchant = findMerchant(text, ctx.merchants);
  let intent = detectIntent(text);
  if (!intent && (category || merchant)) intent = 'spending';
  if (!intent) return null;
  const period = parsePeriod(text, ctx.today) ?? thisMonth(ctx.today);
  return { intent, categoryId: category, merchant: intent === 'subscriptions' ? undefined : merchant, period, source: 'rules' };
}

// ---------------------------------------------------------------------------------------------
// AI understanding (fallback): the small embedding model compares the question with example
// questions for each kind of lookup. (A 0.5B language model was tried and proved unreliable at this.)
// ---------------------------------------------------------------------------------------------

export const INTENT_EXAMPLES: Record<Intent, string[]> = {
  spending: ['how much did i spend on this', 'how much money went to that', 'what is my total spending on it', 'how much have i paid for this', 'what did it cost me'],
  income: ['how much money came in', 'how much did i earn', 'what was my income', 'how much did i get paid', 'how much was deposited'],
  top_categories: ['what did i spend the most on', 'where did my money go', 'what are my biggest spending categories', 'breakdown of my spending by category', 'what am i spending too much on'],
  top_merchants: ['which stores do i spend the most at', 'where do i shop the most', 'which companies get most of my money', 'my top merchants'],
  subscriptions: ['what subscriptions do i have', 'which streaming services am i paying for', 'list my recurring charges', 'what memberships do i pay for'],
  net_worth: ['what is my net worth', 'how much am i worth', 'what do i own minus what i owe'],
  budget: ['am i over budget', 'how much is left in my budget', 'am i on track with my budget', 'how is my budget looking'],
  largest: ['what was my biggest purchase', 'what is the most expensive thing i bought', 'my largest single expense', 'what was my priciest purchase'],
  count: ['how many times did i go there', 'how often do i buy this', 'number of visits', 'how many purchases did i make there'],
};

export interface IntentMatch {
  intent: Intent;
  similarity: number;
}

/** Closest example question (vectors normalized). */
export function classifyIntent(query: ArrayLike<number>, examples: { intent: Intent; vec: ArrayLike<number> }[]): IntentMatch | null {
  let best: IntentMatch | null = null;
  for (const e of examples) {
    let sim = 0;
    for (let i = 0; i < query.length; i++) sim += query[i] * e.vec[i];
    if (!best || sim > best.similarity) best = { intent: e.intent, similarity: sim };
  }
  return best;
}

/** Below this, the question isn't close enough to anything we know how to answer. */
export const INTENT_THRESHOLD = 0.45;
export const CATEGORY_THRESHOLD = 0.5;

type Embed = (texts: string[]) => Promise<ArrayLike<number>[]>;

/**
 * Rules first; if they don't understand the question and the AI is on, the embedding model picks the
 * kind of lookup (and the category, if the rules didn't find one). Dates and store names always come
 * from rules, so they're exact.
 */
export async function understand(question: string, ctx: AskContext, embed?: Embed, categorySeeds?: Record<string, string[]>): Promise<Query | null> {
  const ruled = parseQuestion(question, ctx);
  // Unambiguous phrasing (or no AI): trust the rules. Loose keyword matches let the AI decide first.
  if (!embed || (ruled && detectIntentWithStrength(question)?.strong !== false)) return ruled;
  const intents = Object.entries(INTENT_EXAMPLES).flatMap(([intent, list]) => list.map((text) => ({ intent: intent as Intent, text })));
  const seeds = Object.entries(categorySeeds ?? {})
    .filter(([id]) => ctx.categories.some((c) => c.id === id && c.group === 'expense'))
    .flatMap(([id, list]) => list.map((text) => ({ id, text })));
  const vecs = await embed([question.toLowerCase(), ...intents.map((i) => i.text), ...seeds.map((s) => s.text)]);
  const [q] = vecs;
  const match = classifyIntent(
    q,
    intents.map((i, k) => ({ intent: i.intent, vec: vecs[1 + k] })),
  );
  if (!match || match.similarity < INTENT_THRESHOLD) return ruled;
  let categoryId = findCategory(question, ctx.categories);
  if (!categoryId && ['spending', 'count', 'largest', 'budget'].includes(match.intent)) {
    let best: { id: string; sim: number } | undefined;
    seeds.forEach((s, k) => {
      const v = vecs[1 + intents.length + k];
      let sim = 0;
      for (let i = 0; i < q.length; i++) sim += q[i] * v[i];
      if (!best || sim > best.sim) best = { id: s.id, sim };
    });
    if (best && best.sim >= CATEGORY_THRESHOLD) categoryId = best.id;
  }
  const merchant = match.intent === 'subscriptions' ? undefined : findMerchant(question, ctx.merchants);
  return { intent: match.intent, categoryId, merchant, period: parsePeriod(question, ctx.today) ?? thisMonth(ctx.today), source: 'ai' };
}

// ---------------------------------------------------------------------------------------------
// Answering (exact numbers from your data)
// ---------------------------------------------------------------------------------------------

export interface AnswerItem {
  label: string;
  value: Cents;
  note?: string;
}

export interface Answer {
  headline: string;
  detail?: string;
  items?: AnswerItem[];
  /** What the question was understood as, so you can tell if it went wrong. */
  interpretation: string;
  filter?: { categoryId?: string; month?: string };
}

export interface AnswerData {
  txns: Transaction[];
  categories: Map<string, Category>;
  recurring: RecurringStatus[];
  budgets: BudgetProgress[];
  netWorth: { net: Cents; change: Cents; since: ISODate };
}

const money = (c: Cents) => formatMoney(c);
/** "in August 2026" / "in 2025", but "this month", "last week", "since March", "the last 30 days" as-is. */
const when = (p: Period) => (/^(this|last|today|yesterday|since|the )/.test(p.label) ? p.label : `in ${p.label}`);
const inPeriod = (t: Transaction, p: Period) => t.date >= p.from && t.date <= p.to;

function matchesMerchant(t: Transaction, merchant: string) {
  const m = merchant.toLowerCase();
  return t.payee.toLowerCase().includes(m) || t.description.toLowerCase().includes(m);
}

function spendingTxns(q: Query, d: AnswerData): Transaction[] {
  return d.txns.filter((t) => {
    const cat = d.categories.get(t.categoryId);
    if (!cat || cat.group !== 'expense' || !inPeriod(t, q.period)) return false;
    if (q.categoryId && t.categoryId !== q.categoryId) return false;
    if (q.merchant && !matchesMerchant(t, q.merchant)) return false;
    return true;
  });
}

function groupBy(txns: Transaction[], key: (t: Transaction) => string): AnswerItem[] {
  const m = new Map<string, number>();
  for (const t of txns) m.set(key(t), (m.get(key(t)) ?? 0) - t.amount);
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);
}

function describe(q: Query, d: AnswerData): string {
  const parts = [q.intent.replace('_', ' ')];
  if (q.categoryId) parts.push(d.categories.get(q.categoryId)?.name ?? q.categoryId);
  if (q.merchant) parts.push(`at ${q.merchant}`);
  if (!['subscriptions', 'net_worth', 'budget'].includes(q.intent)) parts.push(q.period.label);
  return parts.join(' · ');
}

function subject(q: Query, d: AnswerData): string {
  if (q.merchant) return ` at ${q.merchant}`;
  if (q.categoryId) return ` on ${d.categories.get(q.categoryId)?.name ?? 'that'}`;
  return '';
}

export function answer(q: Query, d: AnswerData): Answer {
  const interpretation = describe(q, d);
  const singleMonth = q.period.from.slice(0, 7) === q.period.to.slice(0, 7) && q.period.from.endsWith('-01') ? q.period.from.slice(0, 7) : undefined;
  const filter = { categoryId: q.categoryId, month: singleMonth };

  switch (q.intent) {
    case 'spending': {
      const txns = spendingTxns(q, d);
      const total = -txns.reduce((s, t) => s + t.amount, 0);
      const items = q.merchant ? [] : groupBy(txns, (t) => t.payee || t.description).slice(0, 5);
      return {
        headline: `You spent ${money(Math.max(0, total))}${subject(q, d)} ${when(q.period)}.`,
        detail: `${txns.length} transaction${txns.length === 1 ? '' : 's'}${q.categoryId || q.merchant ? '' : ', not counting transfers and card payments'}.`,
        items: items.length ? items : undefined,
        interpretation,
        filter,
      };
    }
    case 'count': {
      const txns = spendingTxns(q, d);
      const total = -txns.reduce((s, t) => s + t.amount, 0);
      return {
        headline: `${txns.length} time${txns.length === 1 ? '' : 's'}${subject(q, d)} ${when(q.period)}, ${money(Math.max(0, total))} in total.`,
        detail: txns.length ? `That's ${money(Math.round(total / txns.length))} on average each time.` : undefined,
        interpretation,
        filter,
      };
    }
    case 'income': {
      const txns = d.txns.filter((t) => d.categories.get(t.categoryId)?.group === 'income' && inPeriod(t, q.period));
      const total = txns.reduce((s, t) => s + t.amount, 0);
      return {
        headline: `You received ${money(total)} in income ${when(q.period)}.`,
        items: groupBy(txns.map((t) => ({ ...t, amount: -t.amount })), (t) => t.payee || t.description).slice(0, 5),
        interpretation,
        filter: { categoryId: 'income', month: singleMonth },
      };
    }
    case 'top_categories': {
      const txns = spendingTxns({ ...q, categoryId: undefined }, d);
      const items = groupBy(txns, (t) => d.categories.get(t.categoryId)?.name ?? 'Other').slice(0, 6);
      const total = -txns.reduce((s, t) => s + t.amount, 0);
      return {
        headline: items.length ? `Your biggest category ${when(q.period)} was ${items[0].label}: ${money(items[0].value)} of ${money(total)}.` : `No spending found ${when(q.period)}.`,
        items,
        interpretation,
        filter: { month: singleMonth },
      };
    }
    case 'top_merchants': {
      const txns = spendingTxns({ ...q, merchant: undefined }, d);
      const items = groupBy(txns, (t) => t.payee || t.description).slice(0, 6);
      return {
        headline: items.length ? `You spent the most at ${items[0].label} ${when(q.period)}: ${money(items[0].value)}.` : `No spending found ${when(q.period)}.`,
        items,
        interpretation,
        filter,
      };
    }
    case 'largest': {
      const txns = spendingTxns(q, d)
        .sort((a, b) => a.amount - b.amount)
        .slice(0, 5);
      return {
        headline: txns.length ? `Your largest expense ${when(q.period)} was ${txns[0].payee || txns[0].description}: ${money(-txns[0].amount)}.` : `No expenses found ${when(q.period)}.`,
        items: txns.map((t) => ({ label: t.payee || t.description, value: -t.amount, note: t.date })),
        interpretation,
        filter,
      };
    }
    case 'subscriptions': {
      const subs = d.recurring.filter((s) => s.rec.status === 'active' && s.rec.kind === 'subscription').sort((a, b) => monthlyCost(b) - monthlyCost(a));
      const monthly = subs.reduce((s, x) => s + monthlyCost(x), 0);
      return {
        headline: subs.length
          ? `You have ${subs.length} subscription${subs.length === 1 ? '' : 's'} costing about ${money(monthly)} a month (${money(monthly * 12)} a year).`
          : `You aren't tracking any subscriptions yet. Review suggestions on the Recurring tab.`,
        items: subs.slice(0, 8).map((s) => ({ label: s.rec.name, value: Math.abs(s.expected), note: FREQUENCIES[s.rec.frequency].label })),
        interpretation,
      };
    }
    case 'net_worth':
      return {
        headline: `Your net worth is ${money(d.netWorth.net)}.`,
        detail: `${d.netWorth.change >= 0 ? 'Up' : 'Down'} ${money(Math.abs(d.netWorth.change))} since ${d.netWorth.since}.`,
        interpretation,
      };
    case 'budget': {
      const list = q.categoryId ? d.budgets.filter((b) => b.categoryId === q.categoryId) : d.budgets;
      if (!list.length) return { headline: q.categoryId ? `There's no budget for ${d.categories.get(q.categoryId)?.name}.` : `You haven't set up budgets yet.`, interpretation };
      const limit = list.reduce((s, b) => s + b.limit, 0);
      const spent = list.reduce((s, b) => s + b.spent, 0);
      const over = list.filter((b) => b.state === 'over');
      return {
        headline: spent <= limit ? `You have ${money(limit - spent)} left of ${money(limit)} budgeted this month.` : `You're ${money(spent - limit)} over your ${money(limit)} budget this month.`,
        detail: over.length ? `Over budget: ${over.map((b) => d.categories.get(b.categoryId)?.name).join(', ')}.` : undefined,
        items: list.map((b) => ({ label: d.categories.get(b.categoryId)?.name ?? b.categoryId, value: b.spent, note: `of ${money(b.limit)}` })),
        interpretation,
      };
    }
  }
}

export const EXAMPLES = [
  'How much did I spend on dining last month?',
  'What are my subscriptions?',
  'Where did my money go this month?',
  'How many times did I go to Starbucks this year?',
  'What was my biggest purchase in August?',
  'Am I over budget?',
];
