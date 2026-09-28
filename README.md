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

## Roadmap

- **Phase 3:** Budgets & spending trends (category budgets, charts)
- **Phase 4:** Net worth history & savings goals
- **Phase 5:** On-device AI (categorization + "ask about your money") via an in-browser model

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
