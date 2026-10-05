# Finance Tracker

A private personal finance app for iPhone, in the spirit of Rocket Money, where **everything stays on the device**.
There's no server, no account, no bank login and no analytics. The app is a Home Screen web app (PWA): it opens full-screen,
works offline, and keeps its data in the phone's local database (IndexedDB).

## Install on iPhone

1. Open the app's URL in **Safari** (`https://weinfurtmatthew-rgb.github.io/Finance-tracker/`).
2. Tap **Share** → **Add to Home Screen**.
3. Open it from the Home Screen icon from now on. Home Screen apps keep their own storage and are exempt from Safari's
   7-day cleanup of website data.

The first launch shows a short intro (what stays private, how to bring in transactions, keeping a backup).
**Settings → About** has the version and build, the **Privacy** policy in plain words, and the intro again.

> Your data lives only on this phone. Deleting the Home Screen icon deletes the data too, so use
> **Settings → Back Up Now…** regularly and keep the file in iCloud Drive (Today reminds you; choose how often in Settings).

## Getting transactions in

Download a file from your bank's **website** and import it (Activity → ⬇︎ button):

| Bank | Best format | Notes |
|---|---|---|
| Citizens | OFX / QFX | Includes your balance; CSV also works with the column mapper |
| Discover | CSV (or QFX) | Purchases are positive in Discover's CSV. Detected and flipped automatically |
| Capital One | CSV | Card (Debit/Credit columns) and 360 (Transaction Type column) formats detected. ~90 days per download |
| Fidelity | CSV | Header row found below Fidelity's blank lines; buys/sells filed as Investments |
| Rocket Money | Export CSV | All your accounts in one file: pick one at a time ("Import next"). Signs flipped to the bank convention; Rocket Money's store names and categories used. A Rocket Money file imported earlier as a plain CSV gets a one-tap repair (right signs, right accounts, merged with your bank's own files) |
| Venmo | Statement CSV | venmo.com → Statements → Download CSV, monthly. Sets the Venmo balance |
| Cash App | Activity CSV | cash.app → Activity / Statements → Export CSV |
| Apple Cash | (no export) | Card-funded payments show in your bank's file; use People → Log a Payment for the rest |

Any other bank's CSV works through the column mapper, which is remembered per file layout. Re-importing an overlapping date range
skips transactions you already have, even from a different kind of file (a CSV month, then the same month as a QFX statement):
rows are matched one to one by amount, store name and date (a few days apart for posting dates), and listed on the review
screen with an "Import these anyway" switch. A QFX file finds the account an earlier CSV went into and remembers its number.
Settings → Duplicate Imports (and a card on Today) finds and removes copies from before this, keeping your edits and the
balance your bank confirmed.

**Undo an import** from its summary screen (Undo This Import), or later from Settings → Backup → Undo Last Import (the
last 5, newest first). It removes what the import added and puts back anything it changed: a new account, a balance it
set, payment-app lines it merged, remembered file columns (`src/lib/importUndo.ts`).

## Features

### Look & feel

- Frosted-glass cards over soft, still light that takes its color from the screen (green on Today, blue on
  Activity, violet on Recurring…), with a fine grain so large areas don't look flat
- A floating glass tab bar, glass buttons and controls, and rounded numerals for amounts
- Line icons for the built-in categories, colored by family: food orange, getting around violet, shopping magenta,
  home & bills yellow, money coming in aqua. Categories you make (or give your own emoji) keep their emoji
- **Accent color** (Settings → Appearance): Blue, Green, Violet, Orange, Pink or Graphite recolors buttons, links,
  the selected tab and highlights; each is checked for readable contrast in light and dark mode
- Everything is free. Settings → About → **Support Finance Tracker** opens a pay-what-you-want link when the app is
  built with `VITE_SUPPORT_URL` set (nothing is unlocked or checked); until then it says support is coming soon
- Light and dark mode each have their own colors; Reduce Transparency gives solid surfaces, and Reduce Motion turns
  the animations off
- Motion (subtle, Apple-like): the first time you open a screen in a visit its cards rise in one after another,
  big numbers count up, and charts draw themselves (bars grow, lines draw, the Spend Readiness dial lights segment by
  segment, the Money Health ring sweeps to its score). Numbers roll to new values when they change. The tab pill
  slides between tabs, the screen recedes behind an open sheet, sheets slide back down when closed, and cards and
  toggles respond to a press
- Two gentle things keep moving: on Today, your spot on the pace chart pulses slowly and the dial's glow breathes;
  the Year in Review and Money Health cards get an occasional sheen. They pause while the app is in the background
- Small celebrations for good moments: your first backup, reaching a savings goal, and finishing a month with every
  budget held (once each)
- Accessibility: every control has a VoiceOver name, keyboard focus shows a tinted ring, and an automated check (axe)
  scans the main screens and sheets in the browser tests, along with a check that nothing scrolls sideways
- Fast to open: Import, Plan and Settings load the first time you open them (they're still saved for offline use)

### Today

- **Your day in money:** a few plain sentences: how the month is pacing, which category is running hot (or
  cool), and the bills landing before your next paycheck
- **Spend Readiness (0–10):** how comfortable today is for spending. Pace this month (40%), bills before payday
  vs. checking (25%), your cash cushion (20%) and the last 7 days vs. a typical week (15%). 9–10 Go For It,
  7–8 On Track, 4–6 Pace Yourself, 0–3 Hold Off. Tap it to see each part
- **Left to spend** and a day-by-day **pace chart**, against your budgets, or your usual month when you have none.
  Everyday spending leaves out rent, bills and subscriptions
- The summary offers the category running hottest and coolest against your usual, a tap away
- **Coming up:** bills before payday (or this week), **Money on hand** (checking & cash, savings, what's on your cards)
  and your three most **Recent** transactions
- **To do:** one list for everything that wants a minute (back up, categorize, review bills, set budgets, paybacks,
  AI picks…), most important first, three at a time. The month-by-month dashboard and charts are in **Browse → Spending**

### What "spent" means

One rule everywhere (`src/lib/spend.ts`), so Today, Spending, Activity, the plan and Money Health agree:

- **Spent** = purchases in expense categories, minus refunds. Transfers, card payments, money you're owed back and
  income never count. Split transactions count once per part
- Spent = **Everyday** + **Bills**. Bills are rent, utilities, insurance, subscriptions, car payments and taxes (by
  category, right away, before you confirm anything), plus charges for any bill you track. Everyday is the rest:
  it's what Today paces and what budgets are suggested for

### Money Health

- A 0–100 score for the bigger picture (85+ Great · 65–84 Good · 45–64 Fair · under 45 Needs work), drawn as a ring
  of six parts: spend less than you earn (25%), cash cushion (20%), bills on time (15%), long-term savings (15%),
  debt load (15%) and planning (10%)
- Each part shows where you are and the next step; the weakest one is shown on Today. Open it from Browse
- A part the app has nothing to go on for (no income found, no investment or card accounts added) says **Not enough
  info** and is left out; the others count for more. With under half the picture there's no overall score yet

### Activity

- A month card (spent, came in, number of transactions) with arrows to step through months. Its totals follow the
  list's filters and search
- Quick filters: All · Spending · Income · Needs review (no category yet, or an AI guess), plus account, category
  and tag filters and search
- Transactions grouped by day, with each day's total (transfers between your accounts left out)

### Detail pages

- **Category:** average a month, a 6-month or yearly chart with your budget line, a highlight ("your priciest dining
  month since May"), budget progress with a pace marker (or set one), top places this month, recent transactions,
  and **Pin** to put it in Browse with this month's total
- **Store:** this year's total and visits, average visit, a monthly chart, and every visit (from a category's top
  places or Search → Places)
- **Account:** balance (or amount owed) with a chart over 6 months, a year or all time, when it was last checked
  against the bank, and recent activity; **Edit** opens the account settings

### Getting around

- Three tabs: **Today**, **Activity** and **Browse**, plus a round **Search** button
- **Browse** has every feature once, grouped: **Money** (Spending, Budgets, Bills & Subscriptions, Net Worth, Money
  Health), **Plan & Look Back** (Plan, Year in Review) and **People & Trips** (People, with money owed to you, and
  Trips & Tags). Show it as a list or as tiles (the button at the top; remembered). **Edit** pins your favorites to
  the top with their number (Net Worth, Spending, Money Health and Year in Review to start)
- Each feature has one home: what you look at is in Browse, setup (categories, rules, duplicates, backup) is in
  Settings, and importing is in Activity
- **Search** puts its box at the bottom, by your thumb. Before you type it shows your recent searches, the places you go
  most and example questions; as you type, a **top hit** (the category or store you most likely mean), then categories,
  places, #tags and transactions (by store, note, amount or category). Type a question ("how much did I spend on
  dining last month?") and press return to get the answer right there
- **Settings** opens from the profile button, top right on every tab

### Venmo, Cash App & Apple Cash

- Each app is a **Payment app** account with its own balance (counted as cash in net worth and the calculators).
  Import a Venmo statement or Cash App export once a month; the file is recognized automatically.
- **Nothing counts twice:** a payment paid from your bank or debit card appears in both your bank's file and the app's.
  They become one transaction: the bank's line, with the person, note and category from the app. Import in either
  order; a payment waits in the app account until its bank line arrives, then merges. Re-importing skips what you have.
- **Transfers** between the app and your bank (cash out, add money, instant transfer) are filed under Transfer on both sides.
- **Paybacks:** money from a friend that matches what they owe you asks "Alex paid you back $24?". One tap settles
  it, and the payment isn't counted as income.
- Payments are categorized from the note, emoji included (🍕 Dining, 🏠 Rent, 🍻 Bars…), plus your history with that
  person and the on-device AI. Money from friends is never guessed as income. Ones with no clue go to
  **What was this?** (Today's To do list).
- **People** (Settings): what you've sent to and received from each person, and what they owe you. Ask "how much have
  I sent Alex?" or "who owes me?". **Log a Payment** there covers Apple Cash, which has no export.

### Splits, owed money, categories & tags

- **Split a transaction** into parts that add up to the total, each with its own category (a Target run: $80
  Groceries + $40 Household). Budgets, charts, Ask and the calculators count each part in its category.
- **Paid for someone else:** mark a whole transaction, or one part of a split, as owed by a person. It's not your
  spending; it shows on **Owed to You** (Today's To do list, and Browse → People) until you mark it paid back, picking the Venmo or
  deposit that repaid you (that repayment isn't counted as income) or "paid in cash".
- **More built-in categories:** Coffee, Alcohol & Bars, Clothing, Electronics, Home & Garden, Pets, Kids, Car Payment,
  Car Maintenance, Fitness, Taxes, Charity (plus Owed to Me), with import keywords for common stores.
- **Your own categories:** create one right from any category picker, pick an emoji and color, reorder, hide ones you
  don't use, or merge two (moves transactions, split parts, rules, bills and budgets).
- **Tags** for trips and events: add them on any transaction, or **Tag a Trip** by date range. Each tag shows what it
  cost by category; filter Activity by tag, or ask "how much did the Italy trip cost?".

### Balance check & tidy-up

- After a CSV import, type what your bank shows; OFX/QFX files are checked automatically. Differences are explained
  (possible duplicates, a missing date range, pending charges, a never-set starting balance) with a fix for each.
  Accounts show when they last matched.
- **Tidy Up Old Categories** (Settings → Categories & Rules): a one-time review of older guessed categories, with confident AI
  picks filled in.

### Year in review

A Spotify Wrapped–style recap of your money, as tap-through story cards and as a scrolling page with charts. It's
pinned in Browse ("2026 so far") and in Plan, for this year, the last 12 months or any past year, and it opens by
itself once in December (and in early January for the year just ended). Cards appear only when your data supports
them: totals and savings rate, top categories and places, your #1 spot, biggest purchase and priciest/lightest
months, no-spend days and streaks, your busiest weekday, subscriptions (new, cancelled and what that saved), net
worth, goals reached, debt paid down and fees, vs the year before, trips (tags), months within budget, paychecks and
any raise, and a playful spending style. **Save as Image** draws a summary on your phone for you to share.

### Plan: financial calculators

Open **Browse → Plan**. Every calculator starts from your own numbers (cash, 3-month average
spending and income, investments, card and loan balances, savings APY) and says where each came from; change any of
them to try a what-if. Results are estimates, not advice.

- **Emergency fund:** how many months your cash covers, progress toward a 3–6 month target, and when you'll get there
- **Can I afford it?:** pay in full or finance; cash and cushion afterwards, the monthly payment and interest, a
  comfortable / tight / stretch verdict with reasons, and what the money could grow to if invested instead
- **Rent calculator:** what cheap, acceptable and expensive rent looks like for you, from take-home pay (25% / 30%
  rules) checked against your real other costs and a savings goal (the lower limit wins, and it says which). Split with
  roommates evenly (utilities optionally too), include or leave out utilities and extras, and see ranges for your
  share or the whole place on a colored band. Type a listing's rent for a verdict and a bar of where your take-home
  goes. Enter your gross salary for the landlord check (40× rent). Ask "what rent can I afford?" or "can I afford
  $1,400 rent?"
- **Debt payoff:** avalanche (highest APR first) vs snowball (smallest balance first) with extra payments, payoff
  dates, total interest and a chart. Set each card's APR and minimum on the account; otherwise typical values are used
- **True cost of a habit:** pick a subscription or a place you go often; what it costs over 1–30 years vs investing it
- **Savings growth:** your savings at your APY (typed on the account, or estimated from the interest you received)
- **Investment growth:** a start plus monthly contributions at 7% a year, also shown in today's dollars (3% inflation),
  with the Rule of 72
- **Financial independence:** your FI number (yearly spending ÷ 4%) and years to reach it at your savings rate
- **Will my money last?:** a Monte Carlo test of a retirement budget in 1,000 random markets

### On-device AI (Phase 5, optional)

Turned on in **Settings → On-device AI**: a one-time 24 MB download from this app's own site, then it works offline.
It uses a small embedding model (all-MiniLM-L6-v2) running in the browser with
[Transformers.js](https://github.com/huggingface/transformers.js).

- **Ask about your money:** questions are understood by rules first; when they can't, the model matches the question to
  example questions. The app then **calculates the answer from your data**. AI never produces the numbers, and every
  answer shows how it was understood.
- **Smarter categorizing:** the closest payees you've categorized (plus short phrases for each category) vote on
  a category. It respects the direction of money (money in is never spending, money out is never income), trusts your
  own choices most, and only calls a pick "Likely" when one category clearly wins.
  - **At import**, confident picks for transactions that would otherwise be uncategorized, the income fallback or a
    bank's catch-all "Other" are applied automatically, marked ✨, and listed under **Review AI Picks**. Unreviewed picks
    never teach the AI, so a mistake can't reinforce itself.
  - **Learns silently:** fixing a category also offers to fix the same payee's other guessed transactions, and future
    imports from that payee (including refunds) use your choice, with no rule needed.
- **Monthly recap** on Spending, computed exactly from your data.
- **"What is this?"** on a transaction: decodes bank codes (TST*, SQ*, AMZN Mktp…) and suggests a name and category.

A 490 MB language model (Qwen2.5-0.5B) was tried and removed: it was unreliable at understanding questions, invented
numbers in recaps, and needed more memory than Safari allows on iPhone.

Every feature works with AI off. The model isn't in git: CI downloads it (`scripts/fetch-models.mjs`) into the
published site and runs `tests/ai-smoke.test.ts` against it.

### Net worth & goals (Phase 4)

- **Net Worth tab** (formerly Accounts): net worth with change since last month (per account), and a chart over
  6 months / 1 year / all time, as net worth or **assets vs debts**, with a crosshair readout and table view
- History is rebuilt from your transactions for cash accounts, cards and loans; **investments and vehicles** keep a
  history of the values you enter (Update Values), with a reminder when a value is over 30 days old
- **Vehicle** account type (resale value), alongside auto loans as regular loan accounts
- **Savings goals** linked to an account: progress bar, projected finish date at your recent 3-month pace, and, with a
  target date, how much to save **per month and per paycheck** (using the paycheck from Recurring)

### Budgets & spending (Phase 3)

- **Spending dashboard** (Browse → Spending) with a month switcher: "left to spend" hero number, Spent / Bills paid / Net worth tiles
- **Monthly category budgets**, pre-filled from your last 3 months of everyday spending (rounded up), fresh start each month
- Bills & subscriptions tracked under Recurring are **bills**: shown separately, never counted against budgets
- Budget bars with an even-pace marker; warnings at **80% used** and when you're **on pace to overspend**
- Charts: **spending by month** (12 months, tap to switch month), **income vs spending** (6 months, with amount saved),
  **where it went** (ranked categories), and **category history** with the budget line. Each chart has a table view.
- Chart colors validated for color-blind safety and contrast in light & dark mode

### Subscriptions & bills (Phase 2)

- **Bills & Subscriptions** (Browse) with Upcoming, Calendar and All views
- **Detection:** the app suggests repeating charges (weekly, every 2 weeks, twice a month, monthly, quarterly, yearly) and you confirm each one.
  Apple's `APPLE.COM/BILL` charges are split by amount into separate subscriptions. Charges that have stopped aren't suggested.
- Tracks subscriptions, bills & utilities, rent & loans, credit card payments, paychecks and **free trials**
- **Totals:** monthly cost, yearly cost, due this month, and **left after bills** (checking balance minus bills due before your next payday)
- **Paid status:** marked automatically when a matching charge is imported, or tap **Mark paid**
- **Price increase alerts** for charges whose price used to be steady (rule set in Settings: %, $, any, or off)
- **Predicting variable bills:** average of last 3 / same as last / manual, set in Settings with a per-bill override
- **Cancelling:** links to cancel pages for well-known services, "money saved since cancelling", and a warning if it charges again
- **Upcoming** bills on Today (3 days ahead by default, configurable)

### Basics (Phase 1)

- Accounts (checking, savings, credit cards, investments, loans) with balances and net worth
- CSV / OFX / QFX / QBO import with bank auto-detection, preview and duplicate detection
- Auto-categorization: your rules → merchant keywords → the bank's category
- "Always categorize this merchant as…?" rules created from your corrections
- Search and filter activity by account, category and month
- Manual transactions
- 6-digit passcode lock with auto-lock
- Backup / restore (JSON) and CSV export. A backup can be **protected with a password** (AES-256-GCM, with the key made
  from the password by PBKDF2-SHA256, 600,000 rounds, all on the phone; the password is never stored). Every backup
  is read back and compared with the app's data before it's offered to save, and **Check a Backup File…** confirms
  an older backup still opens without changing anything
- Light & dark mode
- **Updates never interrupt you.** A new version downloads in the background and waits, then is put in place at a quiet
  moment: right as the app opens, or when you leave it with nothing open on screen (you come back to the same screen).
  A half-filled form is never reloaded away (`src/updates.ts`)
- **What's New** shows once after an update, listing what changed since the last notes you saw; it's always in Settings →
  About. Notes live in `src/releaseNotes.ts`: add an entry with each change people would notice

## Development

```sh
npm install
npm run dev        # http://localhost:5173/finance-tracker/
npm test           # unit tests (parsers, categorizer, dedupe, balances, recurring detection & schedules)
npm run build      # production build in dist/
npm run e2e        # phone-size browser tests (builds, serves and clicks through the app in Chromium)
npm run perf       # speed with three years of history (~4,500 transactions), at full speed and a 4× slower CPU
```

The browser tests live in `e2e/` with sample bank files in `e2e/fixtures/`. They run at iPhone size with the
clock frozen at 29 Sep 2026 (the sample files' dates), in light mode, plus the `@smoke` tests in dark mode. AI
screens use a small stand-in model. `e2e/a11y.e2e.ts` runs axe on the main screens and sheets. First time: `npx playwright install chromium` (or point `PW_CHROMIUM` at an
existing Chromium).

All screens read one shared copy of the data (`src/store.tsx`): each table is read once and re-read only when it
changes, and what's worked out from it (bills, spending by month, balances, the plan numbers, Money Health, the search
index) is computed once and shared until its inputs change.

Stack: Vite, Preact, TypeScript, Dexie (IndexedDB), vite-plugin-pwa (offline service worker), Papa Parse.
A strict Content-Security-Policy (`connect-src 'self'`) prevents the app from sending data to any other server.

Every push runs the unit tests, the browser tests and the real-AI smoke test; pushing to `main` then deploys to
GitHub Pages (see `.github/workflows/deploy.yml`). A failing browser test stops the deploy.
