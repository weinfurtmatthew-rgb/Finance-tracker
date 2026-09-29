import type { CategorySource, Rule, Transaction } from '../types';
import { CARD_PAYMENT, TRANSFER, UNCATEGORIZED } from './categories';

/** 'in' keywords only match money coming in (e.g. "dividend"). */
type Sign = 'out' | 'in' | 'any';
type Keyword = [category: string, sign: Sign, needles: string[]];

/** Built-in keyword guesses, used when neither your rules nor the bank's category decide. */
const KEYWORDS: Keyword[] = [
  [CARD_PAYMENT, 'any', ['payment thank you', 'crcardpmt', 'credit card payment', 'card payment', 'cc payment', 'directpay']],
  // On a credit card, money coming in labelled as a payment is you paying the card.
  [CARD_PAYMENT, 'in', ['autopay', 'auto pay', 'online payment', 'internet payment', 'mobile pymt', 'mobile payment', 'e-payment', 'epayment', 'payment received']],
  [TRANSFER, 'any', ['transfer to', 'transfer from', 'online transfer', 'xfer', 'electronic funds transfer', 'transferred from', 'transferred to']],
  ['investments', 'any', ['you bought', 'you sold', 'reinvestment']],
  ['interest', 'in', ['dividend', 'interest paid', 'interest earned', 'int earned', 'interest payment']],
  ['income', 'in', ['payroll', 'direct dep', 'dir dep', 'salary', 'paycheck']],
  ['fees', 'out', ['interest charge', 'late fee', 'annual fee', 'overdraft', 'service fee', 'foreign transaction fee', 'monthly fee', 'atm fee']],
  ['subscriptions', 'out', ['netflix', 'spotify', 'hulu', 'disney plus', 'disneyplus', 'hbo', 'max.com', 'youtube premium', 'youtubepremium', 'apple.com/bill', 'icloud', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'audible', 'paramount', 'peacock', 'patreon', 'adobe', 'dropbox', 'nytimes', 'siriusxm', 'amazon prime', 'prime video', 'crunchyroll']],
  ['car-payment', 'out', ['auto loan', 'car payment', 'toyota financial', 'honda financial', 'ally auto', 'capital one auto', 'ford credit', 'gm financial', 'tesla finance', 'hyundai motor fin', 'nissan motor acc']],
  ['car-maintenance', 'out', ['jiffy lube', 'autozone', 'car wash', 'firestone', 'midas', 'pep boys', 'valvoline', 'advance auto', "o'reilly auto", 'oreilly auto', 'discount tire', 'meineke', 'safelite', 'take 5 oil']],
  ['taxes', 'out', ['irs usataxpymt', 'irs treas', 'us treasury tax', 'dept of revenue', 'department of revenue', 'franchise tax', 'state tax pmt', 'property tax', 'tax payment']],
  ['coffee', 'out', ['starbucks', 'dunkin', "peet's", 'peets coffee', 'blue bottle', 'dutch bros', 'tim hortons', 'caribou coffee', 'philz', 'coffee', 'espresso']],
  ['alcohol', 'out', ['liquor', 'wine & spirits', 'total wine', 'brewery', 'brewing co', 'taproom', 'tavern', ' pub ', 'beer', 'spirits', 'bevmo', 'binny']],
  ['groceries', 'out', ['whole foods', 'wholefds', 'trader joe', 'kroger', 'safeway', 'aldi', 'wegmans', 'publix', 'stop & shop', 'stop and shop', 'market basket', 'shoprite', 'h-e-b', 'costco', "sam's club", 'sams club', 'grocery', 'instacart', 'hannaford', 'giant eagle', 'food lion', 'star market', 'price chopper', 'big y', 'sprouts']],
  ['dining', 'out', ['restaurant', 'mcdonald', 'chipotle', 'doordash', 'uber eats', 'ubereats', 'grubhub', 'pizza', 'cafe', 'taco bell', "wendy's", 'burger', 'chick-fil-a', 'panera', 'sweetgreen', 'domino', 'tst*', 'bar & grill', 'kitchen', 'diner', 'bakery']],
  ['gas', 'out', ['shell oil', 'shell service', 'exxon', 'mobil ', 'sunoco', 'chevron', 'citgo', 'speedway', 'gulf oil', 'marathon petro', 'valero', 'irving oil', 'cumberland farms', 'bp#', 'bp ', 'fuel', 'quiktrip', 'wawa', 'sheetz', 'racetrac', 'circle k']],
  ['transport', 'out', ['uber', 'lyft', 'mbta', 'parking', 'toll', 'e-zpass', 'ezpass', 'metro', 'transit', 'park mobile', 'parkmobile']],
  ['travel', 'out', ['airline', 'airlines', 'delta air', 'united air', 'american air', 'jetblue', 'southwest', 'spirit air', 'frontier', 'airbnb', 'marriott', 'hilton', 'hyatt', 'hotel', 'expedia', 'booking.com', 'amtrak', 'vrbo']],
  ['bills', 'out', ['verizon', 'at&t', 't-mobile', 'comcast', 'xfinity', 'spectrum', 'national grid', 'eversource', 'con ed', 'electric', 'water bill', 'utility', 'utilities', 'pg&e', 'duke energy', 'internet', 'mint mobile']],
  ['insurance', 'out', ['geico', 'progressive', 'state farm', 'allstate', 'liberty mutual', 'insurance']],
  ['fitness', 'out', ['planet fitness', 'gym', 'equinox', 'orangetheory', 'peloton', 'ymca', 'crossfit', 'la fitness', 'crunch fitness', 'anytime fitness', 'soulcycle', 'classpass', 'yoga']],
  ['pets', 'out', ['petco', 'petsmart', 'chewy', 'veterinary', 'animal hospital', 'banfield', 'rover.com', 'bark box', 'barkbox']],
  ['kids', 'out', ['daycare', 'childcare', 'child care', 'kindercare', 'bright horizons', 'toys', "carter's", 'babies', 'buy buy baby']],
  ['health', 'out', ['cvs', 'walgreens', 'pharmacy', 'rite aid', 'dental', 'medical', 'hospital', 'doctor', 'clinic', 'optometr']],
  ['entertainment', 'out', ['amc ', 'regal', 'ticketmaster', 'steam', 'playstation', 'xbox', 'nintendo', 'stubhub', 'cinema', 'theater', 'theatre']],
  ['housing', 'out', ['rent ', 'rent payment', 'mortgage', 'property mgmt', 'apartments']],
  ['home', 'out', ['home depot', "lowe's", 'lowes', 'ikea', 'wayfair', 'ace hardware', 'bed bath', 'true value', 'menards', 'harbor freight', 'garden', 'nursery']],
  ['electronics', 'out', ['best buy', 'apple store', 'b&h photo', 'micro center', 'newegg', 'apple.com/us']],
  ['clothing', 'out', ['tj maxx', 'marshalls', 'nordstrom', 'macy', 'old navy', 'kohl', 'gap ', 'h&m', 'zara', 'uniqlo', 'nike', 'adidas', 'lululemon', 'j.crew', 'banana republic', 'american eagle', 'ross stores', 'burlington']],
  ['shopping', 'out', ['amazon', 'amzn', 'target', 'walmart', 'wal-mart', 'etsy', 'ebay']],
  ['charity', 'out', ['donation', 'charity', 'gofundme', 'red cross', 'unicef', 'salvation army', 'united way', 'st jude']],
  ['gifts', 'out', ['gift shop', 'giftcard', 'gift card', '1-800-flowers', 'flowers']],
];

/** Map the category text some banks include (Discover, Capital One) onto ours. */
const BANK_CATEGORIES: [RegExp, string][] = [
  [/award|rebate|cash ?back/i, 'income'],
  [/payment|credits?$/i, CARD_PAYMENT],
  [/supermarket|grocer/i, 'groceries'],
  [/restaurant|dining/i, 'dining'],
  [/gas(oline)?|fuel/i, 'gas'],
  [/automotive|transport/i, 'transport'],
  [/travel|airfare|lodging/i, 'travel'],
  [/merchandise|shopping|department store|warehouse club/i, 'shopping'],
  [/phone|cable|internet|utilit/i, 'bills'],
  [/health|medical|pharmac/i, 'health'],
  [/entertainment/i, 'entertainment'],
  [/insurance/i, 'insurance'],
  [/education/i, 'education'],
  [/fee|interest/i, 'fees'],
  [/government|services|other|miscellaneous/i, 'other'],
];

export function categoryFromBank(bankCategory: string | undefined): string | null {
  if (!bankCategory?.trim()) return null;
  for (const [re, id] of BANK_CATEGORIES) if (re.test(bankCategory)) return id;
  return null;
}

/** True when `needle` appears in `text` starting at a word boundary ("rent" matches "rent pmt", not "current"). */
function containsWord(text: string, needle: string): boolean {
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(text[i - 1])) return true;
  }
  return false;
}

/** Paying a card from checking: "DISCOVER E-PAYMENT", "CAPITAL ONE MOBILE PYMT", "CHASE CREDIT CRD AUTOPAY". */
const CARD_PAYMENT_RE = /\b(discover|capital one|chase|citi|citibank|amex|american express|barclays|synchrony|applecard|apple card|bk of amer|bank of america|wells fargo card|us bank|fidelity rewards)\b.*\b(pay|pymt|pmt|payment|autopay|epay|e-payment)\b/;

/** Category from built-in merchant keywords, or null when nothing matches. */
export function keywordCategory(description: string, amount: number): string | null {
  const text = ` ${description.toLowerCase().replace(/\s+/g, ' ')} `;
  if (CARD_PAYMENT_RE.test(text)) return CARD_PAYMENT;
  for (const [category, sign, needles] of KEYWORDS) {
    // 'out' keywords also match money coming back (refunds), so a refund offsets that category's spending.
    if (sign === 'in' && amount < 0) continue;
    if (needles.some((n) => containsWord(text, n))) return category;
  }
  return null;
}

export function guessCategory(description: string, amount: number): string {
  return keywordCategory(description, amount) ?? (amount > 0 ? 'income' : UNCATEGORIZED);
}

/** Longest (most specific) match wins. */
export function findRule(rules: Rule[], description: string, payee: string): Rule | undefined {
  const text = `${description}\n${payee}`.toLowerCase();
  let best: Rule | undefined;
  for (const r of rules) {
    const m = r.match.trim().toLowerCase();
    if (m && text.includes(m) && (!best || m.length > best.match.trim().length)) best = r;
  }
  return best;
}

export interface Categorized {
  payee: string;
  categoryId: string;
  source: CategorySource;
}

/** Transactions whose category you chose or confirmed yourself (or a rule chose). */
export const isTrusted = (t: Pick<Transaction, 'categorySource'>) => t.categorySource === 'user' || t.categorySource === 'rule';

/** A payee's usual category, learned from the transactions you've categorized yourself. */
export type PayeeHistory = Map<string, string>;

export const payeeKey = (payee: string) => payee.trim().toLowerCase();

export function payeeHistory(txns: Transaction[]): PayeeHistory {
  const counts = new Map<string, Map<string, number>>();
  for (const t of txns) {
    if (!isTrusted(t) || t.categoryId === UNCATEGORIZED) continue;
    const k = payeeKey(t.payee);
    const m = counts.get(k) ?? new Map<string, number>();
    m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    counts.set(k, m);
  }
  const out: PayeeHistory = new Map();
  for (const [k, m] of counts) out.set(k, [...m].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}

export function categorize(
  input: { description: string; payee: string; amount: number; bankCategory?: string; creditAccount?: boolean },
  rules: Rule[],
  history: PayeeHistory = new Map(),
): Categorized {
  const rule = findRule(rules, input.description, input.payee);
  const payee = rule?.payee || input.payee;
  if (rule?.categoryId) return { payee, categoryId: rule.categoryId, source: 'rule' };
  // Order: the bank's payment/reward labels, then what you've chosen for this payee before (a refund
  // lands in the category you use for that store), then specific merchant keywords, then the bank's
  // broad category, then a fallback.
  const fromBank = categoryFromBank(input.bankCategory);
  if (fromBank === CARD_PAYMENT || fromBank === 'income') return { payee, categoryId: fromBank, source: 'bank' };
  const known = history.get(payeeKey(payee));
  if (known) return { payee, categoryId: known, source: 'history' };
  const fromKeywords = keywordCategory(input.description, input.amount);
  if (fromKeywords) return { payee, categoryId: fromKeywords, source: 'keyword' };
  if (fromBank) return { payee, categoryId: fromBank, source: 'bank' };
  // Unknown money coming in: on a checking account it's most likely income, but on a credit card
  // it's a refund or credit, which is never income.
  const fallback = input.amount > 0 && !input.creditAccount ? 'income' : UNCATEGORIZED;
  return { payee, categoryId: fallback, source: 'default' };
}

/** Categories that are only a guess, which the AI may replace when it's confident. */
export const isWeakCategory = (t: Pick<Transaction, 'categoryId' | 'categorySource'>) =>
  t.categoryId === UNCATEGORIZED || t.categorySource === 'default' || (t.categorySource === 'bank' && t.categoryId === 'other');
