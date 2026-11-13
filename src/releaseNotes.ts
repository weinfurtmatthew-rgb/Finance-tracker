/**
 * What's new, newest first. Add an entry with each change people would notice; the newest one is shown
 * once after the update arrives (and any they missed since the last one they saw). Keep each line to
 * what it means for the person using the app, in plain words.
 */
export interface Release {
  /** Unique and never reused: the date it shipped, with a letter if there are two in a day. */
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    id: '2026-11-13',
    date: 'November 13, 2026',
    title: 'Smoother edges',
    items: [
      'What scrolls under the tab bar fades out softly instead of showing around its edges.',
      'Amounts use a true minus sign, so −$12.34 lines up with +$12.34.',
      'Longer lines break evenly, and lines with dots between their parts (like Money Health’s) break between the parts. Plan’s calculator list and bill suggestions show their whole description.',
      'The welcome screens keep their icon and title in the same place as you go through them.',
    ],
  },
  {
    id: '2026-11-10',
    date: 'November 10, 2026',
    title: 'A tidier look',
    items: [
      'Categories use one set of icons everywhere: Spending, Budgets and Year in Review show the same colored icons as your transactions. Categories you made keep their emoji.',
      'Labels in forms and calculators stay on one line, and category names in Spending are no longer cut off.',
    ],
  },
  {
    id: '2026-11-09',
    date: 'November 9, 2026',
    title: 'Mortgage calculator',
    items: [
      'Plan has a mortgage calculator: a home’s monthly cost with property tax, insurance, PMI and HOA, and what it is next to your take-home pay and your rent now.',
      'See the price that fits your budget, the cash you’d need to buy, and how paying a little extra each month shortens the loan.',
    ],
  },
  {
    id: '2026-11-08e',
    date: 'November 8, 2026',
    title: 'Taxes, and what’s worth a look',
    items: [
      'Portfolio starts with what’s worth a look: shares about to turn long-term, holdings below what you paid (with a heads-up on wash sales), a lot riding on one company, and big drops. Facts, not advice.',
      'Taxes, for brokerage accounts: what you sold this year, short- and long-term, your dividends, and what selling everything today would realize.',
      'The market: how far the S&P 500 is from its high, and from its 200-day average.',
      'Each holding shows its high and low of the last year, and its shares by term. Today reminds you when shares are about to turn long-term, and Year in Review has an Investments card.',
    ],
  },
  {
    id: '2026-11-08d',
    date: 'November 8, 2026',
    title: 'Import your positions',
    items: [
      'On an investment account’s page, import a positions file from Fidelity, Schwab or Vanguard: every holding and the cash, in one go.',
      'Each holding starts at its value that day and keeps its cost basis, so its gain is right from the start.',
      'Import again later to catch up: more or fewer shares are bought or sold, and anything no longer in the file can be sold.',
    ],
  },
  {
    id: '2026-11-08c',
    date: 'November 8, 2026',
    title: 'Mix and dividends',
    items: [
      'Portfolio shows your mix: US and international stocks, bonds, real estate and cash. Popular funds and companies are known; set the rest on a holding’s page.',
      'Set a target mix, and see how far each part is from it and what would put it back.',
      'It points out when one company, your three biggest, or one industry is a lot of your investments.',
      'Dividends: the last 12 months, the next 12 at the same rate, your yield, and when the next ones are due.',
    ],
  },
  {
    id: '2026-11-08b',
    date: 'November 8, 2026',
    title: 'Portfolio',
    items: [
      'Browse → Portfolio puts everything in your investment accounts together: what it’s worth, and how it did today, this week, this month, in 6 months, this year or since you started.',
      'See it next to the S&P 500: the same money, put in on the same days, with dividends reinvested. Money you add or take out isn’t counted as a gain.',
      'Each holding’s own return, the best and worst, and after a year, your yearly return.',
    ],
  },
  {
    id: '2026-11-08',
    date: 'November 8, 2026',
    title: 'Stocks, ETFs and funds',
    items: [
      'Add what’s in an investment account, IRA or 401(k): on its page in Net Worth, tap Add a Stock, ETF or Fund.',
      'Turn on stock prices in Settings with a free Twelve Data key. Then how much you put in and when is enough: the app works out the shares, follows splits, and reinvests dividends (or pays them into the account’s cash).',
      'Each holding shows what it’s worth, what it cost and your gain, and the account’s value follows its prices.',
      'Without a key, add the shares and type in prices yourself. Only ticker symbols are sent to Twelve Data, never amounts or accounts.',
    ],
  },
  {
    id: '2026-11-04',
    date: 'November 4, 2026',
    title: 'Credit score',
    items: [
      'Track your credit score in Browse → Credit Score: add it from your bank, your card’s app or Credit Karma, see it on a chart, and set a goal.',
      'Add your card limits to see how much of them you’re using. Add a statement day, and Today tells you what to pay before it closes so a low balance is reported.',
      'Credit is now part of Money Health, and Plan uses typical rates for your score.',
      'Year in Review shows how your score changed.',
    ],
  },
  {
    id: '2026-10-21c',
    date: 'October 21, 2026',
    title: '401(k)s',
    items: [
      'Add a 401(k), 403(b) or Roth 401(k) in Net Worth, under Retirement, with the value from your 401(k) site.',
      'Enter what you put in and your employer’s match, and the app checks you get the full match. Today reminds you when you don’t.',
      'See what you’ll put in this year at your rate, against the IRS limit.',
      'Your 401(k) and the match count in your savings rate (Money Health and Financial independence) and in Retirement savings.',
    ],
  },
  {
    id: '2026-10-21b',
    date: 'October 21, 2026',
    title: 'Roth and Traditional IRAs',
    items: [
      'Add a Roth or Traditional IRA in Net Worth with its value today. Contributions you make after that add to it.',
      'See what you’ve put in this year against the IRS limit (for all your IRAs together) and the April 15 deadline.',
      'Import a bank file and money sent to a brokerage shows up in Today: tap IRA Contribution or Not One. You can also add one by hand.',
      'Plan has a Retirement savings calculator: what your IRAs could grow to by the age you retire.',
    ],
  },
  {
    id: '2026-10-21',
    date: 'October 21, 2026',
    title: 'CDs',
    items: [
      'Add a CD in Net Worth: the deposit, when it opened, the term and the APY. It grows on its own, so there’s no value to update.',
      'Today reminds you two weeks before a CD matures. After that, tell the app whether it renewed or you moved the money.',
      'CDs count as investments in Plan and Money Health.',
    ],
  },
  {
    id: '2026-10-05b',
    date: 'October 5, 2026',
    title: 'A simpler app',
    items: [
      'Today is about half as long: your recent transactions, money on hand and bills coming up, then one short To do list.',
      'Browse groups everything into Money, Plan & Look Back, and People & Trips. Show it as a list or as tiles with the button at the top.',
      'Money Health and Year in Review are pinned in Browse. Money owed to you is in People.',
      'Settings is just setup now, with Backup first.',
      'The same names everywhere, like Bills & Subscriptions and Trips & Tags.',
    ],
  },
  {
    id: '2026-10-05',
    date: 'October 5, 2026',
    title: 'Numbers you can trust',
    items: [
      'Today, Spending and Activity now agree: spent is everyday spending plus bills, the same everywhere.',
      'Rent, utilities and other bills count as bills right away, before you confirm anything.',
      'Changed your mind about an import? Undo it from the import screen or Settings → Backup.',
      'Updates wait for a quiet moment instead of reloading while you’re in the middle of something.',
      'Money Health says “not enough info” instead of scoring what it can’t see.',
      'Switching screens and searching are several times faster with years of history.',
    ],
  },
  {
    id: '2026-10-02',
    date: 'October 2, 2026',
    title: 'A livelier app, made yours',
    items: [
      'Numbers count up, charts draw in, and a small celebration marks a goal reached or a month on budget. Reduce Motion in iOS settings keeps it calm.',
      'Pick an accent color in Settings → Appearance.',
      'Activity’s quick filters moved into one Filters button.',
      'Backups can be protected with a password, and checked before you rely on them.',
    ],
  },
];

/** The releases someone hasn't seen yet: those newer than `seen` (just the newest when unknown). */
export function unseenReleases(seen: string | undefined): Release[] {
  if (!seen) return RELEASES.slice(0, 1);
  const i = RELEASES.findIndex((r) => r.id === seen);
  return i === -1 ? RELEASES.slice(0, 1) : RELEASES.slice(0, i);
}
