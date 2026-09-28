/** Turn raw bank descriptions like "SQ *BLUE BOTTLE COFFEE  OAKLAND  CA" into "Blue Bottle Coffee". */

const PREFIXES = [
  /^(pos|debit card|check ?card|visa|recurring)( purchase| payment| debit)?( authorized on \d{1,2}\/\d{1,2})?\s*/i,
  /^purchase authorized on \d{1,2}\/\d{1,2}\s*/i,
  /^debit card purchase\s*/i,
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

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])([a-z']*)/g, (_, a: string, rest: string) => a.toUpperCase() + rest)
    .replace(/\b(Llc|Inc|Co)\b/g, (w) => w.toUpperCase());
}

export function cleanPayee(raw: string): string {
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
