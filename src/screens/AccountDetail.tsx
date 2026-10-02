import { useMemo, useState } from 'preact/hooks';
import { CountUp } from '../components/motion';
import { byId, useAccounts, useBook, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account } from '../types';
import { balanceOn, historyDates, type Range } from '../lib/networth';
import { isLiability } from '../lib/balances';
import { formatShortDate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { LineChart } from '../components/charts';
import { Segmented, Sheet } from '../components/ui';
import { Glyph } from '../components/icons';
import { TransactionRow } from '../components/TransactionRow';
import { AccountEditor } from './AccountEditor';

/** An account up close: its balance over time, when it was last checked, and recent activity. */
export function AccountDetail(props: { account: Account; onClose: () => void }) {
  // The live account, so edits made from here show up right away.
  const a = useAccounts().find((x) => x.id === props.account.id) ?? props.account;
  const nav = useNav();
  const book = useBook();
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const [range, setRange] = useState<Range>('6m');
  const today = todayISO();
  const owed = isLiability(a);
  const dates = useMemo(() => historyDates(book, today, range), [book, today, range]);
  const values = dates.map((d) => {
    const b = balanceOn(book, a, d);
    return owed ? -b : b;
  });
  const now = balanceOn(book, a);
  const recent = useMemo(() => txns.filter((t) => t.accountId === a.id).slice(0, 8), [txns, a.id]);
  const edit = () => nav.present((close) => <AccountEditor account={a} onClose={close} />);

  return (
    <Sheet title={a.name} onClose={props.onClose} onSave={edit} saveLabel="Edit" closeLabel="Done">
      <section class="card lit detail-hero-card account-hero" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 14%, transparent)' }}>
        <span class="card-label">{owed ? 'Owed' : 'Balance'}</span>
        <CountUp class="detail-big num" value={owed ? Math.abs(now) : now} format={(c) => formatMoney(c)} />
        <span class="card-sub">
          {[a.institution, a.last4 && `•••• ${a.last4}`, a.checkedOn ? `checked against the bank ${formatShortDate(a.checkedOn)}` : 'not checked against the bank yet']
            .filter(Boolean)
            .join(' · ')}
        </span>
        {dates.length > 1 && (
          <>
            <Segmented
              value={range}
              options={[
                { value: '6m', label: '6 months' },
                { value: '1y', label: 'Year' },
                { value: 'all', label: 'All' },
              ]}
              onChange={setRange}
            />
            <LineChart
              title={`${a.name} ${owed ? 'balance owed' : 'balance'} over time`}
              dates={dates}
              labels={dates.map((d) => formatShortDate(d))}
              series={[{ name: owed ? 'Owed' : 'Balance', color: owed ? 'var(--chart-2)' : 'var(--chart-1)', values }]}
            />
          </>
        )}
      </section>
      <div class="button-stack">
        <button type="button" class="button" onClick={() => nav.showActivity({ accountId: a.id })}>
          <Glyph name="list" /> All {a.name} transactions
        </button>
      </div>
      {recent.length > 0 && (
        <section class="section">
          <h3 class="section-title">Recent</h3>
          <div class="group">
            {recent.map((t) => (
              <TransactionRow txn={t} category={cats.get(t.categoryId)} />
            ))}
          </div>
        </section>
      )}
    </Sheet>
  );
}
