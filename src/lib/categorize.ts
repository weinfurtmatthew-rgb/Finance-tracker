import type { Rule } from '../types';
import { TRANSFER, UNCATEGORIZED } from './categories';

/** 'in' keywords only match money coming in (e.g. "dividend"). */
type Sign = 'out' | 'in' | 'any';
type Keyword = [category: string, sign: Sign, needles: string[]];

/** Built-in keyword guesses, used when neither your rules nor the bank's category decide. */
const KEYWORDS: Keyword[] = [
  [TRANSFER, 'any', ['payment thank you', 'crcardpmt', 'credit card payment', 'card payment', 'cc payment', 'transfer to', 'transfer from', 'online transfer', 'xfer', 'electronic funds transfer', 'transferred from', 'transferred to', 'directpay']],
  // On a credit card, money coming in labelled as a payment is you paying the card.
  [TRANSFER, 'in', ['autopay', 'auto pay', 'online payment', 'internet payment', 'mobile pymt', 'mobile payment', 'e-payment', 'epayment', 'payment received']],
  ['investments', 'any', ['you bought', 'you sold', 'reinvestment']],
  ['interest', 'in', ['dividend', 'interest paid', 'interest earned', 'int earned', 'interest payment']],
  ['income', 'in', ['payroll', 'direct dep', 'dir dep', 'salary', 'paycheck']],
  ['fees', 'out', ['interest charge', 'late fee', 'annual fee', 'overdraft', 'service fee', 'foreign transaction fee', 'monthly fee', 'atm fee']],
  ['subscriptions', 'out', ['netflix', 'spotify', 'hulu', 'disney plus', 'disneyplus', 'hbo', 'max.com', 'youtube premium', 'youtubepremium', 'apple.com/bill', 'icloud', 'openai', 'chatgpt', 'anthropic', 'claude.ai', 'audible', 'paramount', 'peacock', 'patreon', 'adobe', 'dropbox', 'nytimes', 'siriusxm', 'amazon prime', 'prime video', 'crunchyroll']],
  ['groceries', 'out', ['whole foods', 'wholefds', 'trader joe', 'kroger', 'safeway', 'aldi', 'wegmans', 'publix', 'stop & shop', 'stop and shop', 'market basket', 'shoprite', 'h-e-b', 'costco', "sam's club", 'sams club', 'grocery', 'instacart', 'hannaford', 'giant eagle', 'food lion', 'star market', 'price chopper', 'big y', 'sprouts']],
  ['dining', 'out', ['restaurant', 'starbucks', 'dunkin', 'mcdonald', 'chipotle', 'doordash', 'uber eats', 'ubereats', 'grubhub', 'pizza', 'cafe', 'coffee', 'taco bell', "wendy's", 'burger', 'chick-fil-a', 'panera', 'sweetgreen', 'domino', 'tst*', 'bar & grill', 'kitchen', 'diner', 'bakery']],
  ['gas', 'out', ['shell oil', 'shell service', 'exxon', 'mobil ', 'sunoco', 'chevron', 'citgo', 'speedway', 'gulf oil', 'marathon petro', 'valero', 'irving oil', 'cumberland farms', 'bp#', 'bp ', 'fuel']],
  ['transport', 'out', ['uber', 'lyft', 'mbta', 'parking', 'toll', 'e-zpass', 'ezpass', 'metro', 'transit', 'park mobile', 'parkmobile', 'jiffy lube', 'autozone', 'car wash']],
  ['travel', 'out', ['airline', 'airlines', 'delta air', 'united air', 'american air', 'jetblue', 'southwest', 'spirit air', 'frontier', 'airbnb', 'marriott', 'hilton', 'hyatt', 'hotel', 'expedia', 'booking.com', 'amtrak', 'vrbo']],
  ['bills', 'out', ['verizon', 'at&t', 't-mobile', 'comcast', 'xfinity', 'spectrum', 'national grid', 'eversource', 'con ed', 'electric', 'water bill', 'utility', 'utilities', 'pg&e', 'duke energy', 'internet', 'mint mobile']],
  ['insurance', 'out', ['geico', 'progressive', 'state farm', 'allstate', 'liberty mutual', 'insurance']],
  ['health', 'out', ['cvs', 'walgreens', 'pharmacy', 'rite aid', 'dental', 'medical', 'hospital', 'doctor', 'clinic', 'optometr', 'gym', 'planet fitness']],
  ['entertainment', 'out', ['amc ', 'regal', 'ticketmaster', 'steam', 'playstation', 'xbox', 'nintendo', 'stubhub', 'cinema', 'theater', 'theatre']],
  ['housing', 'out', ['rent ', 'rent payment', 'mortgage', 'property mgmt', 'apartments']],
  ['shopping', 'out', ['amazon', 'amzn', 'target', 'walmart', 'wal-mart', 'best buy', 'etsy', 'ebay', 'home depot', "lowe's", 'lowes', 'ikea', 'apple store', 'tj maxx', 'marshalls', 'nordstrom', 'macy', 'old navy', 'kohl']],
  ['gifts', 'out', ['donation', 'charity', 'gofundme']],
];

/** Map the category text some banks include (Discover, Capital One) onto ours. */
const BANK_CATEGORIES: [RegExp, string][] = [
  [/award|rebate|cash ?back/i, 'income'],
  [/payment|credits?$/i, TRANSFER],
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
const CARD_PAYMENT = /\b(discover|capital one|chase|citi|citibank|amex|american express|barclays|synchrony|applecard|apple card|bk of amer|bank of america|wells fargo card|us bank|fidelity rewards)\b.*\b(pay|pymt|pmt|payment|autopay|epay|e-payment)\b/;

/** Category from built-in merchant keywords, or null when nothing matches. */
export function keywordCategory(description: string, amount: number): string | null {
  const text = ` ${description.toLowerCase().replace(/\s+/g, ' ')} `;
  if (CARD_PAYMENT.test(text)) return TRANSFER;
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
}

export function categorize(
  input: { description: string; payee: string; amount: number; bankCategory?: string },
  rules: Rule[],
): Categorized {
  const rule = findRule(rules, input.description, input.payee);
  const payee = rule?.payee || input.payee;
  if (rule?.categoryId) return { payee, categoryId: rule.categoryId };
  // Order: the bank's payment/reward labels, then specific merchant keywords, then the bank's broad
  // category (refunds keep it, so they offset that category's spending), then a fallback.
  const fromBank = categoryFromBank(input.bankCategory);
  if (fromBank === TRANSFER || fromBank === 'income') return { payee, categoryId: fromBank };
  const fromKeywords = keywordCategory(input.description, input.amount);
  return { payee, categoryId: fromKeywords ?? fromBank ?? guessCategory(input.description, input.amount) };
}
