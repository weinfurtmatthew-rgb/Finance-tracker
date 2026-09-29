/**
 * "Ask about your money": a question is turned into a structured query (by simple rules, or by the
 * on-device language model when the rules don't understand it), and the app then computes the answer
 * from your data. The model never produces numbers itself.
 */
import type { Category, Cents, ISODate, Transaction } from '../types';
import { lines, owedByPerson, owedItems, tagKey } from '../lib/lines';
import { people, samePerson } from '../lib/p2p';
import { checkRent, rentLimits } from '../lib/rent';

/** "$1,400", "1400 dollars", "1.4k". */
export function findAmount(text: string): Cents | undefined {
  const m = text.match(/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?|(\d[\d,]*(?:\.\d+)?)\s*(k|dollars|bucks)\b/i);
  if (!m) return undefined;
  const n = parseFloat((m[1] ?? m[3]).replace(/,/g, ''));
  const k = (m[2] ?? m[4] ?? '').toLowerCase() === 'k';
  return Number.isFinite(n) ? Math.round(n * (k ? 1000 : 1) * 100) : undefined;
}
import { addDays, addMonths, dayInMonth, monthKey, monthLabel } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { FREQUENCIES, monthlyCost, type RecurringStatus } from '../lib/recurring';
import type { BudgetProgress } from '../lib/budgets';

export const INTENTS = ['spending', 'income', 'top_categories', 'top_merchants', 'subscriptions', 'net_worth', 'budget', 'largest', 'count', 'owed', 'person', 'rent'] as const;
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
  /** A tag like "Italy 2026": everything tagged with it. */
  tag?: string;
  /** A friend you pay through Venmo & co, or who owes you. */
  person?: string;
  /** A dollar amount in the question ("can I afford $1,400 rent?"). */
  amount?: Cents;
  period: Period;
  source: 'rules' | 'ai';
}

export interface AskContext {
  today: ISODate;
  categories: Category[];
  /** Known payee names, for recognizing merchants in questions. */
  merchants: string[];
  /** Tags you've used, for "how much did the Italy trip cost?". */
  tags?: string[];
  /** People you pay or who owe you, for "how much have I sent Alex?". */
  people?: string[];
}

const COMMON_WORDS = new Set(['will', 'may', 'june', 'april', 'august', 'mark', 'bill', 'pat', 'rich', 'sue', 'grace', 'joy', 'hope', 'art', 'max', 'amazon', 'target']);

/** A person named in the question: full name, or first name ("Alex" for "Alex Smith"). */
export function findPerson(text: string, names: string[] = []): string | undefined {
  const t = text.toLowerCase();
  let best: string | undefined;
  for (const n of names) {
    const name = n.toLowerCase().trim();
    const first = name.split(/\s+/)[0];
    // First names that are also everyday words only count in full.
    const vague = first.length < 3 || COMMON_WORDS.has(first);
    if (vague && !containsPhrase(t, name)) continue;
    if (containsPhrase(t, name) || containsPhrase(t, first) || containsPhrase(t, `${first}'s`)) {
      if (!best || name.length > best.length) best = n;
    }
  }
  return best;
}

/** A tag named in the question: its full name, or its distinctive first word ("italy" for "Italy 2026"). */
export function findTag(text: string, tags: string[] = []): string | undefined {
  const t = text.toLowerCase();
  let best: string | undefined;
  for (const tag of tags) {
    const name = tagKey(tag);
    const first = name.split(/\s+/)[0];
    if (containsPhrase(t, name) || containsPhrase(t, `#${name}`) || (first.length >= 4 && containsPhrase(t, first))) {
      if (!best || name.length > best.length) best = tag;
    }
  }
  return best;
}

/** "the Italy trip" names the tag, not the Travel category (but "flights on the Italy trip" is Travel). */
function withoutTripWord(categoryId: string | undefined, text: string, tag: string | undefined) {
  if (tag && categoryId === 'travel' && !/\b(travel|flights?|hotels?|airfare)\b/i.test(text)) return undefined;
  return categoryId;
}

/** Tags cover trips and events, so a tag question without dates means all time. */
const allTime = (today: ISODate): Period => ({ from: '0000-01-01', to: today, label: 'overall' });

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
  dining: ['dining', 'restaurant', 'restaurants', 'eating out', 'eat out', 'takeout', 'take out', 'take-out', 'fast food', 'food delivery'],
  coffee: ['coffee', 'coffees', 'lattes', 'coffee shops', 'starbucks runs'],
  alcohol: ['alcohol', 'drinks', 'bars', 'booze', 'beer', 'wine'],
  clothing: ['clothes', 'clothing', 'apparel', 'shoes'],
  electronics: ['electronics', 'gadgets', 'tech'],
  home: ['home improvement', 'hardware', 'furniture', 'garden'],
  pets: ['pets', 'pet', 'dog', 'cat', 'vet'],
  kids: ['kids', 'kid', 'children', 'daycare', 'childcare', 'toys'],
  'car-payment': ['car payment', 'car payments', 'auto loan'],
  'car-maintenance': ['car maintenance', 'car repairs', 'oil changes', 'car repair'],
  fitness: ['gym', 'fitness', 'workouts', 'classes'],
  taxes: ['taxes', 'tax'],
  charity: ['charity', 'donations', 'donated'],
  groceries: ['grocery', 'groceries', 'supermarket', 'supermarkets'],
  gas: ['gas', 'fuel', 'gasoline'],
  transport: ['transportation', 'transport', 'rides', 'rideshare', 'parking', 'tolls', 'transit'],
  shopping: ['shopping'],
  bills: ['bills', 'utilities', 'utility', 'electric', 'electricity', 'internet', 'phone bill'],
  housing: ['rent', 'mortgage', 'housing'],
  entertainment: ['entertainment', 'movies', 'concerts', 'games', 'fun'],
  health: ['health', 'medical', 'doctor', 'doctors', 'pharmacy'],
  travel: ['travel', 'trips', 'trip', 'flights', 'hotels', 'vacation'],
  personal: ['personal care', 'haircut', 'haircuts', 'salon'],
  education: ['education', 'school', 'tuition'],
  gifts: ['gifts', 'presents'],
  insurance: ['insurance'],
  fees: ['fees', 'bank fees', 'interest charges'],
  'card-payment': ['credit card payment', 'credit card payments', 'card payment', 'card payments', 'paid my credit card', 'pay on my credit card', 'pay on my credit cards', 'paid off my card', 'paid on my card', 'paid on my cards'],
};

function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(text);
}

export function findCategory(text: string, categories: Category[]): string | undefined {
  const t = text.toLowerCase();
  let best: { id: string; len: number } | undefined;
  for (const c of categories) {
    // Moving money between accounts is never what a question is "about", but card payments can be.
    if (c.group === 'transfer' && c.id !== 'card-payment') continue;
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
  // "What rent can I afford?", "is $1,400 rent too much?" (but not "how much did I spend on rent?").
  if (/\b(rent|apartment)\b/.test(t) && /afford|should i|too (much|high|expensive)|\bcheap\b|\bmax\b|what rent|rent (can|should)|how much rent/.test(t))
    return strong('rent');
  if (/\bowes? me\b|\bowed to me\b|\bowe me\b|paid me back|pay me back|owe(s)? (you|me) money/.test(t)) return strong('owed');
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
  const tag = findTag(text, ctx.tags);
  const category = withoutTripWord(findCategory(text, ctx.categories), text, tag);
  const person = findPerson(text, ctx.people);
  let intent = detectIntent(text);
  // "How much have I sent Alex?", "what did Jordan pay me?", "how much did I venmo Casey?"
  if (person && !category && intent !== 'owed' && (intent === null || /\b(sent|send|sending|venmo'?e?d?|cash ?app'?e?d?|paid|pay|gave|give|received|got|transferred)\b/i.test(text))) intent = 'person';
  const merchant = intent === 'person' || intent === 'owed' ? undefined : findMerchant(text, ctx.merchants);
  if (!intent && (category || merchant || tag)) intent = 'spending';
  if (!intent) return null;
  const everything = tag || intent === 'person' || intent === 'owed';
  if (intent === 'rent') return { intent, amount: findAmount(text), period: thisMonth(ctx.today), source: 'rules' };
  const period = parsePeriod(text, ctx.today) ?? (everything ? allTime(ctx.today) : thisMonth(ctx.today));
  return { intent, categoryId: category, merchant: intent === 'subscriptions' ? undefined : merchant, tag, person: intent === 'person' || intent === 'owed' ? person : undefined, period, source: 'rules' };
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
  owed: ['who owes me money', 'who still has to pay me back', 'how much am i owed', 'what do my friends owe me'],
  rent: ['what rent can i afford', 'how much should i spend on an apartment', 'is this rent too expensive for me'],
  person: ['how much have i sent my friend', 'how much did i venmo them', 'how much has my roommate paid me', 'money between me and a friend'],
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
  const tag = findTag(question, ctx.tags);
  let categoryId = withoutTripWord(findCategory(question, ctx.categories), question, tag);
  if (!categoryId && !tag && ['spending', 'count', 'largest', 'budget'].includes(match.intent)) {
    let best: { id: string; sim: number } | undefined;
    seeds.forEach((s, k) => {
      const v = vecs[1 + intents.length + k];
      let sim = 0;
      for (let i = 0; i < q.length; i++) sim += q[i] * v[i];
      if (!best || sim > best.sim) best = { id: s.id, sim };
    });
    if (best && best.sim >= CATEGORY_THRESHOLD) categoryId = best.id;
  }
  const person = match.intent === 'person' || match.intent === 'owed' ? findPerson(question, ctx.people) : undefined;
  if (match.intent === 'person' && !person) return ruled;
  const merchant = match.intent === 'subscriptions' || person ? undefined : findMerchant(question, ctx.merchants);
  const everything = tag || match.intent === 'person' || match.intent === 'owed';
  return { intent: match.intent, categoryId, merchant, tag, person, period: parsePeriod(question, ctx.today) ?? (everything ? allTime(ctx.today) : thisMonth(ctx.today)), source: 'ai' };
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
  filter?: { categoryId?: string; month?: string; tag?: string };
}

export interface AnswerData {
  /** For rent questions: monthly take-home and everything else you spend (rent left out). */
  rent?: { takeHome: Cents; otherCosts: Cents };
  txns: Transaction[];
  categories: Map<string, Category>;
  recurring: RecurringStatus[];
  budgets: BudgetProgress[];
  netWorth: { net: Cents; change: Cents; since: ISODate };
}

const money = (c: Cents) => formatMoney(c);
/** "in August 2026" / "in 2025", but "this month", "last week", "since March", "the last 30 days" as-is. */
const when = (p: Period) => (/^(this|last|today|yesterday|since|the |overall)/.test(p.label) ? p.label : `in ${p.label}`);
const inPeriod = (t: Transaction, p: Period) => t.date >= p.from && t.date <= p.to;

function matchesMerchant(t: Transaction, merchant: string) {
  const m = merchant.toLowerCase();
  return t.payee.toLowerCase().includes(m) || t.description.toLowerCase().includes(m);
}

function spendingTxns(q: Query, d: AnswerData): Transaction[] {
  // Split transactions count once per part, each in its own category.
  return lines(d.txns).filter((t) => {
    const cat = d.categories.get(t.categoryId);
    if (!cat || !inPeriod(t, q.period)) return false;
    // Spending means expense categories; asking about a specific non-spending category (like card
    // payments) looks at money out in that category.
    if (q.categoryId ? t.categoryId !== q.categoryId || t.amount >= 0 : cat.group !== 'expense') return false;
    if (q.merchant && !matchesMerchant(t, q.merchant)) return false;
    if (q.tag && !t.tags?.some((x) => tagKey(x) === tagKey(q.tag!))) return false;
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
  if (q.tag) parts.push(`#${q.tag}`);
  if (q.person) parts.push(q.person);
  if (!['subscriptions', 'net_worth', 'budget', 'owed'].includes(q.intent)) parts.push(q.period.label);
  return parts.join(' · ');
}

function subject(q: Query, d: AnswerData): string {
  if (q.tag) return ` on #${q.tag}`;
  if (q.merchant) return ` at ${q.merchant}`;
  if (q.categoryId) return ` on ${d.categories.get(q.categoryId)?.name ?? 'that'}`;
  return '';
}

export function answer(q: Query, d: AnswerData): Answer {
  const interpretation = describe(q, d);
  const singleMonth = q.period.from.slice(0, 7) === q.period.to.slice(0, 7) && q.period.from.endsWith('-01') ? q.period.from.slice(0, 7) : undefined;
  const filter = { categoryId: q.categoryId, month: singleMonth, tag: q.tag };

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
      // Two parts of one split purchase are still one visit.
      const times = new Set(txns.map((t) => t.id)).size;
      return {
        headline: `${times} time${times === 1 ? '' : 's'}${subject(q, d)} ${when(q.period)}, ${money(Math.max(0, total))} in total.`,
        detail: times ? `That's ${money(Math.round(total / times))} on average each time.` : undefined,
        interpretation,
        filter,
      };
    }
    case 'income': {
      const txns = lines(d.txns).filter((t) => d.categories.get(t.categoryId)?.group === 'income' && inPeriod(t, q.period));
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
    case 'owed': {
      const all = owedByPerson(owedItems(d.txns));
      const list = q.person ? all.filter((p) => samePerson(p.who, q.person)) : all;
      const total = list.reduce((s, p) => s + p.total, 0);
      if (!list.length)
        return { headline: q.person ? `${q.person} doesn't owe you anything.` : `Nobody owes you money right now.`, detail: 'Mark a purchase as “Paid for someone else” to track it.', interpretation };
      return {
        headline: q.person ? `${list[0].who} owes you ${money(total)}.` : `${list.length === 1 ? `${list[0].who} owes` : `${list.length} people owe`} you ${money(total)}.`,
        items: q.person ? list[0].items.map((i) => ({ label: i.txn.payee, value: i.amount, note: i.date })) : list.map((p) => ({ label: p.who, value: p.total, note: `${p.items.length} thing${p.items.length === 1 ? '' : 's'}` })),
        interpretation,
      };
    }
    case 'person': {
      const p = people(d.txns, q.period).find((x) => samePerson(x.name, q.person));
      const name = p?.name ?? q.person ?? 'them';
      if (!p || (!p.sent && !p.received)) return { headline: `No payments with ${name} ${when(q.period)}.`, interpretation };
      const net = p.received - p.sent;
      return {
        headline: `You sent ${name} ${money(p.sent)} and received ${money(p.received)} ${when(q.period)}.`,
        detail: `${p.txns.length} payment${p.txns.length === 1 ? '' : 's'}. ${net === 0 ? 'You’re even.' : net < 0 ? `On balance you paid ${money(-net)} more.` : `On balance they paid ${money(net)} more.`}`,
        items: p.txns.slice(0, 6).map((t) => ({ label: t.p2p?.note || t.payee, value: Math.abs(t.amount), note: `${t.amount < 0 ? 'sent' : 'received'} ${t.date}` })),
        interpretation,
      };
    }
    case 'rent': {
      if (!d.rent || d.rent.takeHome <= 0) return { headline: 'Import a few months with your paychecks first, then I can size rent for you.', interpretation: 'rent' };
      const inputs = { takeHome: d.rent.takeHome, otherCosts: d.rent.otherCosts, savingsGoal: Math.round((d.rent.takeHome * 0.2) / 100) * 100, people: 1, includeExtras: false, utilities: 0, splitUtilities: true, personalExtras: 0, grossYearly: 0 };
      const l = rentLimits(inputs);
      if (q.amount) {
        const c = checkRent(inputs, q.amount, l);
        const word = c.tier === 'cheap' ? 'cheap' : c.tier === 'acceptable' ? 'acceptable' : 'expensive';
        return {
          headline: `${money(q.amount)} rent is ${word} for you: ${Math.round(c.ofTakeHome * 100)}% of your take-home.`,
          detail: c.savingsShort > 0 ? `You could save ${money(c.saves)} a month, ${money(c.savingsShort)} short of saving 20%.` : `You'd still save 20% of your pay. Open Plan → Rent calculator for roommates and extras.`,
          interpretation: `rent check · ${money(q.amount)}`,
        };
      }
      return {
        headline: l.acceptableMax > 0 ? `Acceptable rent for you is up to ${money(l.acceptableMax)} a month; under ${money(l.cheapMax)} is cheap.` : `Your other costs leave no room for rent while saving 20%.`,
        detail: `Based on ${money(d.rent.takeHome)} take-home and ${money(d.rent.otherCosts)} of other costs, saving 20%. Plan → Rent calculator covers roommates and utilities.`,
        interpretation: 'rent ranges',
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
  'Who owes me money?',
];
