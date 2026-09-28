import { useMemo } from 'preact/hooks';
import { byId, useAccounts, useCategories, useMeta, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { accountBalance } from '../lib/balances';
import { addMonths, monthLabel, todayISO, monthKey } from '../lib/dates';
import { summarizeMonth } from '../lib/summary';
import { Empty, Money, Section } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { AccountEditor } from './AccountEditor';
import { ImportFlow } from './Import';
import { Icons } from '../components/icons';

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function Home() {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const categories = useCategories();
  const lastBackup = useMeta<number>('lastBackupAt');
  const cats = useMemo(() => byId(categories), [categories]);
  const acctMap = useMemo(() => byId(accounts), [accounts]);
  const month = monthKey(todayISO());
  const thisMonth = useMemo(() => summarizeMonth(txns, cats, month), [txns, cats, month]);
  const lastMonth = useMemo(() => summarizeMonth(txns, cats, addMonths(month, -1)), [txns, cats, month]);

  const open = accounts.filter((a) => !a.archived);
  let assets = 0;
  let debts = 0;
  for (const a of open) {
    const b = accountBalance(a, txns);
    if (b < 0) debts += b;
    else assets += b;
  }
  const uncategorized = txns.filter((t) => t.categoryId === 'uncategorized').length;
  const backupDue = txns.length > 0 && (!lastBackup || Date.now() - lastBackup > 14 * 86_400_000);

  const addAccount = () => nav.present((close) => <AccountEditor onClose={close} />);
  const importFile = () => nav.present((close) => <ImportFlow onClose={close} />);

  return (
    <>
      <header class="large-title">
        <p class="eyebrow">{monthLabel(month)}</p>
        <h1>Overview</h1>
        {open.length > 0 && (
          <button type="button" class="icon-button" aria-label="Import a file" onClick={importFile}>
            {Icons.import()}
          </button>
        )}
      </header>

      {!isStandalone() && (
        <div class="callout">
          <strong>Install on your iPhone</strong>
          <p>
            In Safari, tap <b>Share</b> → <b>Add to Home Screen</b>. It will open full-screen and work offline, and your data
            stays on this phone.
          </p>
        </div>
      )}

      {open.length === 0 ? (
        <Empty icon="👋" title="Welcome">
          <p>
            Everything you enter stays on this device. Nothing is sent anywhere. Start by adding an account, or import a file you
            downloaded from your bank.
          </p>
          <div class="button-stack">
            <button type="button" class="button primary" onClick={importFile}>
              Import a Bank File
            </button>
            <button type="button" class="button" onClick={addAccount}>
              Add an Account Manually
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div class="cards">
            <button type="button" class="card" onClick={() => nav.setTab('accounts')}>
              <span class="card-label">Net worth</span>
              <Money cents={assets + debts} whole class="card-value" />
              <span class="card-sub">
                <Money cents={assets} whole /> assets · <Money cents={-debts} whole /> owed
              </span>
            </button>
            <button type="button" class="card" onClick={() => nav.showActivity({ month })}>
              <span class="card-label">Spent this month</span>
              <Money cents={thisMonth.spent} whole class="card-value" />
              <span class="card-sub">
                <Money cents={lastMonth.spent} whole /> last month
              </span>
            </button>
          </div>

          {backupDue && (
            <button type="button" class="callout warn" onClick={() => nav.setTab('settings')}>
              <strong>Back up your data</strong>
              <p>{lastBackup ? "It's been over two weeks since your last backup." : "You haven't made a backup yet."} Your data only lives on this phone. Tap to save a backup file.</p>
            </button>
          )}

          {uncategorized > 0 && (
            <button type="button" class="callout" onClick={() => nav.showActivity({ categoryId: 'uncategorized' })}>
              <strong>
                {uncategorized} transaction{uncategorized === 1 ? '' : 's'} to categorize
              </strong>
              <p>Tap to review. When you pick a category, the app offers to remember it for next time.</p>
            </button>
          )}

          {thisMonth.byCategory.length > 0 && (
            <Section title="Top spending this month">
              {thisMonth.byCategory.slice(0, 6).map((c) => {
                const cat = cats.get(c.categoryId);
                const pct = Math.max(2, Math.round((c.spent / thisMonth.byCategory[0].spent) * 100));
                return (
                  <button type="button" class="bar-row" onClick={() => nav.showActivity({ month, categoryId: c.categoryId })}>
                    <span class="bar-label">
                      <span aria-hidden="true">{cat?.emoji}</span> {cat?.name ?? 'Unknown'}
                    </span>
                    <Money cents={c.spent} whole />
                    <span class="bar-track">
                      <span class="bar-fill" style={{ width: `${pct}%`, background: cat?.color }} />
                    </span>
                  </button>
                );
              })}
            </Section>
          )}

          <Section title="Recent activity">
            {txns.length === 0 ? (
              <div class="row muted">No transactions yet.</div>
            ) : (
              txns.slice(0, 6).map((t) => <TransactionRow txn={t} category={cats.get(t.categoryId)} account={acctMap.get(t.accountId)} />)
            )}
            {txns.length > 6 && (
              <button type="button" class="row link-row" onClick={() => nav.showActivity({})}>
                See all activity
              </button>
            )}
          </Section>
        </>
      )}
    </>
  );
}
