/** Turn raw bank descriptions like "SQ *BLUE BOTTLE COFFEE  OAKLAND  CA" into "Blue Bottle Coffee". */

const PREFIXES = [
  /^(pos|debit card|check ?card|visa|recurring)( purchase| payment| debit)?( authorized on \d{1,2}\/\d{1,2})?\s*/i,
  /^purchase authorized on \d{1,2}\/\d{1,2}\s*/i,
  /^debit card purchase\s*/i,
  // Citizens: "DBT CRD 0923 SHAWS #4521 BOSTON MA" (card, then the purchase date).
  /^(dbt|db|pos) ?(crd|card)( \d{4})?\s*/i,
  /^(sq|tst|sp|pp|dd|py|in|bt|ckcd)\s?\*\s*/i,
  /^paypal \*\s*/i,
];

const ALIASES: [RegExp, string][] = [
  [/\b(amzn|amazon)\b/i, 'Amazon'],
  [/\bnetflix\b/i, 'Netflix'],
  [/\bspotify\b/i, 'Spotify'],
  [/\bhulu\b/i, 'Hulu'],
  [/apple\.com\/bill/i, 'Apple'],
  [/\buber\s*eats\b/i, 'Uber Eats'],
  [/\buber\b/i, 'Uber'],
  [/\blyft\b/i, 'Lyft'],
  [/\bstarbucks\b/i, 'Starbucks'],
  [/\bdoordash\b/i, 'DoorDash'],
  [/\bwal-?mart\b/i, 'Walmart'],
  [/\btarget\b/i, 'Target'],
  [/\bcostco\b/i, 'Costco'],
  [/\bwhole ?foods\b/i, 'Whole Foods'],
  [/\btrader joe/i, "Trader Joe's"],
  [/\bchipotle\b/i, 'Chipotle'],
  [/\bmcdonald/i, "McDonald's"],
  [/\bdunkin\b/i, "Dunkin'"],
  [/\bcvs\b/i, 'CVS'],
  [/\bwalgreens\b/i, 'Walgreens'],
  [/\bcomcast|xfinity\b/i, 'Xfinity'],
  [/\bverizon\b/i, 'Verizon'],
  [/\bt-mobile\b/i, 'T-Mobile'],
];

// A brokerage's lines, by what they did and the ticker in parentheses: "YOU BOUGHT PROSPECTUS UNDER
// SEPARATE COVER FIDELITY 500 INDEX FUND (FXAIX) (Cash)" is "Bought FXAIX", where the store-name rules
// would keep only its first words.
const BROKERAGE: [RegExp, (ticker: string) => string][] = [
  [/^YOU BOUGHT\b/, (t) => `Bought ${t}`],
  [/^YOU SOLD\b/, (t) => `Sold ${t}`],
  [/^REINVESTMENT\b/, (t) => `Reinvested in ${t}`],
  [/^DIVIDEND RECEIVED\b/, (t) => `Dividend from ${t}`],
];

function brokeragePayee(raw: string): string | null {
  const s = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const verb = BROKERAGE.find(([re]) => re.test(s));
  if (!verb) return null;
  for (const m of raw.matchAll(/\(([A-Z][A-Z0-9]{0,5}(?:[./][A-Z]{1,2})?)\)/g)) {
    if (['CASH', 'MARGIN', 'SHORT'].includes(m[1])) continue;
    return verb[1](m[1]) + (/\b(OPENING|CLOSING) TRANSACTION\b/.test(s) ? ' option' : '');
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest)
    .replace(/\b(Llc|Inc|Co)\b/g, (w) => w.toUpperCase());
}

export function cleanPayee(raw: string): string {
  return brokeragePayee(raw) ?? merchantName(raw);
}

/** The store-name rules alone (what `cleanPayee` gave brokerage lines before it read them). */
export function merchantName(raw: string): string {
  let s = raw.replace(/\s+$/, '');
  if (!s.trim()) return '';
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  // Banks pad city/state columns with runs of spaces; the merchant is the first chunk.
  s = s.trim().split(/\s{2,}/)[0];
  for (const re of PREFIXES) s = s.replace(re, '');
  // Card purchases often start with the purchase date: "CHECKCARD 0902 SHAWS ...".
  s = s.replace(/^\d{2}\/?\d{2}\s+/, '');
  // Drop store numbers, reference codes and everything after them.
  s = s.replace(/\s*[#*].*$/, '');
  s = s.replace(/\s+\S*\d{3,}.*$/, '');
  s = s.replace(/[\s\-.,]+$/, '').trim();
  if (!s) s = raw.trim();
  return s === s.toUpperCase() ? titleCase(s) : s;
}
