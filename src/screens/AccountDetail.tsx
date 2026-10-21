import { useMemo, useState } from 'preact/hooks';
import { CountUp } from '../components/motion';
import { byId, useAccounts, useBook, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account } from '../types';
import { balanceOn, historyDates, isValued, type Range } from '../lib/networth';
import { isIra } from '../lib/ira';
import { isLiability } from '../lib/balances';
import { formatDate, formatShortDate, todayISO } from '../lib/dates';
import { apyLabel, cdMaturityValue, cdStage } from '../lib/cd';
import { formatMoney } from '../lib/money';
import { LineChart } from '../components/charts';
import { Segmented, Sheet } from '../components/ui';
import { Glyph } from '../components/icons';
import { TransactionRow } from '../components/TransactionRow';
import { AccountEditor } from './AccountEditor';
import { CdMaturitySheet } from './CdMaturity';
import { IraSection } from './Ira';

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
  // CDs: where this term started, the interest since, and what it'll be at maturity.
  const cd = a.type === 'cd' && a.maturesOn ? a : undefined;
  const anchors = book.values.get(a.id) ?? [];
  const termStart = cd ? anchors.find((v) => v.date === cd.openedOn) : undefined;
  const stage = cd ? cdStage(cd, today) : null;

  return (
    <Sheet title={a.name} onClose={props.onClose} onSave={edit} saveLabel="Edit" closeLabel="Done">
      <section class="card lit detail-hero-card account-hero" style={{ '--lit': 'color-mix(in oklab, var(--hue-blue) 14%, transparent)' }}>
        <span class="card-label">{owed ? 'Owed' : cd || isValued(a) ? 'Value' : 'Balance'}</span>
        <CountUp class="detail-big num" value={owed ? Math.abs(now) : now} format={(c) => formatMoney(c)} />
        <span class="card-sub">
          {(cd
            ? [
                a.institution,
                apyLabel(cd.apy),
                cd.openedOn && `since ${formatDate(cd.openedOn)}`,
                `${stage === 'matured' ? 'matured' : 'matures'} ${formatDate(cd.maturesOn!)}`,
                cd.interestPaidOut && 'interest paid out',
              ]
            : isIra(a)
              ? [
                  a.institution,
                  a.type === 'roth-ira' ? 'Roth: tax-free when you take it out in retirement' : 'Traditional: taxed as income when you take it out',
                  anchors.length ? `value updated ${formatShortDate(anchors[anchors.length - 1].date)}` : 'value not set yet',
                ]
              : [a.institution, a.last4 && `•••• ${a.last4}`, a.checkedOn ? `checked against the bank ${formatShortDate(a.checkedOn)}` : 'not checked against the bank yet']
          )
            .filter(Boolean)
            .join(' · ')}
        </span>
        {cd && termStart && (
          <span class="cd-facts">
            <span>
              <span class="card-sub">Deposited</span>
              <b class="num">{formatMoney(termStart.value, { whole: true })}</b>
            </span>
            {!cd.interestPaidOut && (
              <span>
                <span class="card-sub">Interest so far</span>
                <b class="num pos-text">{formatMoney(Math.max(0, now - termStart.value))}</b>
              </span>
            )}
            <span>
              <span class="card-sub">At maturity</span>
              <b class="num">{formatMoney(cdMaturityValue(cd, anchors) ?? now, { whole: true })}</b>
            </span>
          </span>
        )}
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
        {stage === 'matured' && !a.archived && (
          <button type="button" class="button primary" onClick={() => nav.present((close) => <CdMaturitySheet account={a} onClose={close} />)}>
            Renewed or Moved?
          </button>
        )}
        {(!cd || recent.length > 0) && (
          <button type="button" class="button" onClick={() => nav.showActivity({ accountId: a.id })}>
            <Glyph name="list" /> All {a.name} transactions
          </button>
        )}
      </div>
      {isIra(a) && <IraSection account={a} />}
      {recent.length > 0 && !isIra(a) && (
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
