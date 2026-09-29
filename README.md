# Finance Tracker

A private personal finance app for iPhone, in the spirit of Rocket Money, where **everything stays on the device**.
There's no server, no account, no bank login and no analytics. The app is a Home Screen web app (PWA): it opens full-screen,
works offline, and keeps its data in the phone's local database (IndexedDB).

## Install on iPhone

1. Open the app's URL in **Safari** (`https://weinfurtmatthew-rgb.github.io/Finance-tracker/`).
2. Tap **Share** → **Add to Home Screen**.
3. Open it from the Home Screen icon from now on. Home Screen apps keep their own storage and are exempt from Safari's
   7-day cleanup of website data.

> Your data lives only on this phone. Deleting the Home Screen icon deletes the data too, so use
> **Settings → Save Backup…** regularly and keep the file in Files / iCloud Drive.

## Getting transactions in

Download a file from your bank's **website** and import it (Overview or Activity → ⬇︎ button):

| Bank | Best format | Notes |
|---|---|---|
| Citizens | OFX / QFX | Includes your balance; CSV also works with the column mapper |
| Discover | CSV (or QFX) | Purchases are positive in Discover's CSV. Detected and flipped automatically |
| Capital One | CSV | Card (Debit/Credit columns) and 360 (Transaction Type column) formats detected. ~90 days per download |
| Fidelity | CSV | Header row found below Fidelity's blank lines; buys/sells filed as Investments |

Any other bank's CSV works through the column mapper, which is remembered per file layout. Re-importing an overlapping date range
skips transactions you already have.

## Features

### Plan: financial calculators

Tap the calculator button on the Overview. Every calculator starts from your own numbers (cash, 3-month average
spending and income, investments, card and loan balances, savings APY) and says where each came from; change any of
them to try a what-if. Results are estimates, not advice.

- **Emergency fund:** how many months your cash covers, progress toward a 3–6 month target, and when you'll get there
- **Can I afford it?:** pay in full or finance; cash and cushion afterwards, the monthly payment and interest, a
  comfortable / tight / stretch verdict with reasons, and what the money could grow to if invested instead
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
- **Monthly recap** on the Overview, computed exactly from your data.
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

- **Overview dashboard** with a month switcher: "left to spend" hero number, Spent / Fixed bills / Net worth tiles
- **Monthly category budgets**, pre-filled from your last 3 months of everyday spending (rounded up), fresh start each month
- Bills & subscriptions tracked under Recurring are **fixed costs**: shown separately, never counted against budgets
- Budget bars with an even-pace marker; warnings at **80% used** and when you're **on pace to overspend**
- Charts: **spending by month** (12 months, tap to switch month), **income vs spending** (6 months, with amount saved),
  **where it went** (ranked categories), and **category history** with the budget line. Each chart has a table view.
- Chart colors validated for color-blind safety and contrast in light & dark mode

### Subscriptions & bills (Phase 2)

- **Recurring tab** with Upcoming, Calendar and All views
- **Detection:** the app suggests repeating charges (weekly, every 2 weeks, twice a month, monthly, quarterly, yearly) and you confirm each one.
  Apple's `APPLE.COM/BILL` charges are split by amount into separate subscriptions. Charges that have stopped aren't suggested.
- Tracks subscriptions, bills & utilities, rent & loans, credit card payments, paychecks and **free trials**
- **Totals:** monthly cost, yearly cost, due this month, and **left after bills** (checking balance minus bills due before your next payday)
- **Paid status:** marked automatically when a matching charge is imported, or tap **Mark paid**
- **Price increase alerts** for charges whose price used to be steady (rule set in Settings: %, $, any, or off)
- **Predicting variable bills:** average of last 3 / same as last / manual, set in Settings with a per-bill override
- **Cancelling:** links to cancel pages for well-known services, "money saved since cancelling", and a warning if it charges again
- **Upcoming** bills on the Overview (3 days ahead by default, configurable)

### Basics (Phase 1)

- Accounts (checking, savings, credit cards, investments, loans) with balances and net worth
- CSV / OFX / QFX / QBO import with bank auto-detection, preview and duplicate detection
- Auto-categorization: your rules → merchant keywords → the bank's category
- "Always categorize this merchant as…?" rules created from your corrections
- Search and filter activity by account, category and month
- Manual transactions
- 6-digit passcode lock with auto-lock
- Backup / restore (JSON) and CSV export
- Light & dark mode

## Development

```sh
npm install
npm run dev        # http://localhost:5173/finance-tracker/
npm test           # unit tests (parsers, categorizer, dedupe, balances, recurring detection & schedules)
npm run build      # production build in dist/
```

Stack: Vite, Preact, TypeScript, Dexie (IndexedDB), vite-plugin-pwa (offline service worker), Papa Parse.
A strict Content-Security-Policy (`connect-src 'self'`) prevents the app from sending data to any other server.

Pushing to `main` runs the tests and deploys to GitHub Pages (see `.github/workflows/deploy.yml`).
