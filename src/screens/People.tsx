/**
 * Payment apps and the people in them: who paid you back, app payments that need a category, what
 * you've sent and received per person, and quick entry for payments (Apple Cash has no export).
 */
import { useMemo, useState } from 'preact/hooks';
import { db, newId, setMeta } from '../db';
import { byId, useAccounts, useCategories, useMeta, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account, PaymentApp, Transaction } from '../types';
import { formatMoney, parseUserAmount } from '../lib/money';
import { formatDay, todayISO } from '../lib/dates';
import { OWED, TRANSFER, UNCATEGORIZED } from '../lib/categories';
import {
  APP_NAMES,
  appFallback,
  linkWaitingPayments,
  paybackMatches,
  people,
  personOf,
  samePerson,
  unexplainedAppPayments,
  type Payback,
  type Person,
} from '../lib/p2p';
import { owedByPerson, owedItems } from '../lib/lines';
import { categorize, payeeHistory } from '../lib/categorize';
import { CategoryIcon, CategorySelect, Empty, Field, Money, Row, Section, Segmented, Sheet, Toggle } from '../components/ui';
import { TransactionEditor } from './TransactionEditor';
import { OwedSheet, settle } from './Owed';

const PAYBACK_DISMISSED = 'paybackDismissed';
const REVIEW_DISMISSED = 'appReviewDismissed';

/** Paybacks to confirm and app payments to explain, skipping the ones you said no to. */
export function usePaymentAppNudges() {
  const txns = useTransactions();
  const noPayback = useMeta<string[]>(PAYBACK_DISMISSED);
  const noReview = useMeta<string[]>(REVIEW_DISMISSED);
  return useMemo(() => {
    const skip = new Set(noPayback ?? []);
    return {
      paybacks: paybackMatches(txns).filter((p) => !skip.has(p.txn.id)),
      unexplained: unexplainedAppPayments(txns, new Set(noReview ?? [])),
    };
  }, [txns, noPayback, noReview]);
}

async function dismiss(key: string, id: string) {
  const list = ((await db.meta.get(key))?.value as string[] | undefined) ?? [];
  await setMeta(key, [...new Set([...list, id])]);
}

const appLabel = (t: Transaction) => (t.p2p ? APP_NAMES[t.p2p.app] : 'Bank');

/** "Alex paid you back $24?" with one-tap yes / no. */
export function PaybackList(props: { paybacks: Payback[] }) {
  const nav = useNav();
  if (!props.paybacks.length) return null;
  return (
    <Section
      title="Paid back?"
      footer="Money from a friend that matches what they owe you. Yes files it under Owed to Me, so it isn’t counted as income."
    >
      {props.paybacks.map((p) => {
        const what = p.items.length === 1 ? p.items[0].txn.payee : `${p.items.length} things`;
        return (
          <div class="row payback-row">
            <span class="row-main">
              <span class="row-title">
                {personOf(p.txn)} paid you back {formatMoney(p.txn.amount)}?
              </span>
              <span class="row-subtitle">
                {appLabel(p.txn)} · {formatDay(p.txn.date)} · for {what}
              </span>
            </span>
            <span class="row-actions">
              <button type="button" class="pill" onClick={() => void dismiss(PAYBACK_DISMISSED, p.txn.id)}>
                No
              </button>
              <button
                type="button"
                class="pill primary"
                onClick={async () => {
                  await settle(p.items, p.txn.id);
                  nav.toast(`${p.who} is paid up`);
                }}
              >
                Yes
              </button>
            </span>
          </div>
        );
      })}
    </Section>
  );
}

/** App payments the app can't explain: pick a category right here, or open one for more. */
export function WhatWasThis(props: { onClose: () => void }) {
  const nav = useNav();
  const { paybacks, unexplained } = usePaymentAppNudges();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const choose = async (t: Transaction, categoryId: string) => {
    await db.transactions.update(t.id, { categoryId, categorySource: 'user' });
    nav.toast(`Filed under ${cats.get(categoryId)?.name ?? 'that'}`);
  };
  return (
    <Sheet title="Payment Apps" onClose={props.onClose}>
      <PaybackList paybacks={paybacks} />
      {unexplained.length ? (
        <Section
          title="What was this?"
          footer="Venmo, Cash App and Apple Cash payments with no clue about what they were for. Pick a category, or open one to split it or mark it as owed to you."
        >
          {unexplained.map((t) => (
            <div class="row what-row">
              <CategoryIcon category={cats.get(t.categoryId)} />
              <button type="button" class="row-main" onClick={() => nav.present((close) => <TransactionEditor txn={t} onClose={close} />)}>
                <span class="row-title">{personOf(t) ?? t.payee}</span>
                <span class="row-subtitle">
                  {appLabel(t)} · {formatDay(t.date)}
                  {t.p2p?.note ? ` · “${t.p2p.note}”` : ''}
                </span>
              </button>
              <span class="row-detail what-actions">
                <Money cents={t.amount} colored />
                <CategorySelect
                  categories={categories}
                  value={t.categoryId}
                  aria-label={`Category for ${personOf(t) ?? t.payee}`}
                  allowNew={false}
                  onChange={(id) => void choose(t, id)}
                />
              </span>
            </div>
          ))}
        </Section>
      ) : (
        !paybacks.length && (
          <Empty icon="check" title="All explained">
            <p>Every payment-app transaction has a category.</p>
          </Empty>
        )
      )}
      {unexplained.length > 0 && (
        <Section>
          <button
            type="button"
            class="row link-row"
            onClick={async () => {
              for (const t of unexplained) await dismiss(REVIEW_DISMISSED, t.id);
              props.onClose();
            }}
          >
            Skip these for now
          </button>
        </Section>
      )}
    </Sheet>
  );
}

/** Everyone you've paid or been paid by through an app, and anyone who owes you. */
export function PeopleSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const accounts = useAccounts();
  const list = useMemo(() => people(txns), [txns]);
  const hasWallet = accounts.some((a) => a.type === 'wallet' && !a.archived);
  const owed = useMemo(() => owedByPerson(owedItems(txns)), [txns]);
  const owedTotal = owed.reduce((s, p) => s + p.total, 0);
  return (
    <Sheet title="People" onClose={props.onClose}>
      <Section>
        {/* Money people owe you lives here too: most of it is settled through these same apps. */}
        <Row
          title="Owed to You"
          subtitle={owed.length ? `From ${owed.length} ${owed.length === 1 ? 'person' : 'people'}` : 'Nobody owes you right now'}
          detail={owedTotal ? formatMoney(owedTotal) : undefined}
          onClick={() => nav.present((close) => <OwedSheet onClose={close} />)}
        />
        <button type="button" class="row link-row" onClick={() => nav.present((close) => <LogPayment onClose={close} />)}>
          ＋ Log a Payment
        </button>
      </Section>
      {list.length ? (
        <Section title="People" footer="From Venmo, Cash App and Apple Cash, bank lines like “VENMO *ALEX SMITH”, and Owed to You.">
          {list.map((p) => (
            <Row
              icon={<span class="avatar">{initials(p.name)}</span>}
              title={p.name}
              subtitle={summary(p)}
              detail={p.owes > 0 ? <span class="money">owes {formatMoney(p.owes)}</span> : undefined}
              onClick={() => nav.present((close) => <PersonDetail name={p.name} onClose={close} />)}
            />
          ))}
        </Section>
      ) : (
        <Empty icon="users" title="No one yet">
          <p>
            {hasWallet
              ? 'Import a Venmo or Cash App statement, or log a payment, and the people you pay show up here.'
              : 'Import a Venmo statement or Cash App export (Import → Choose a File), or log an Apple Cash payment, and the people you pay show up here.'}
          </p>
        </Empty>
      )}
    </Sheet>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

function summary(p: Person): string {
  const parts = [];
  if (p.sent) parts.push(`sent ${formatMoney(p.sent, { whole: true })}`);
  if (p.received) parts.push(`received ${formatMoney(p.received, { whole: true })}`);
  if (!parts.length && p.owes) parts.push('owes you');
  return parts.join(' · ') || '—';
}

export function PersonDetail(props: { name: string; onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const p = useMemo(() => people(txns).find((x) => x.name === props.name), [txns, props.name]);
  const owed = useMemo(() => owedItems(txns).filter((i) => !i.settledBy && !!p && samePerson(i.who, p.name)), [txns, p]);
  const year = todayISO().slice(0, 4);
  const thisYear = useMemo(
    () => (p ? people(txns, { from: `${year}-01-01`, to: `${year}-12-31` }).find((x) => samePerson(x.name, p.name)) : undefined),
    [txns, p, year],
  );
  if (!p)
    return (
      <Sheet title={props.name} onClose={props.onClose}>
        {null}
      </Sheet>
    );
  return (
    <Sheet title={p.name} onClose={props.onClose}>
      <div class="cards">
        <div class="card">
          <span class="card-label">Sent</span>
          <span class="card-value">{formatMoney(p.sent, { whole: true })}</span>
          {thisYear && (
            <span class="card-sub">
              {formatMoney(thisYear.sent, { whole: true })} in {year}
            </span>
          )}
        </div>
        <div class="card">
          <span class="card-label">Received</span>
          <span class="card-value">{formatMoney(p.received, { whole: true })}</span>
          {thisYear && (
            <span class="card-sub">
              {formatMoney(thisYear.received, { whole: true })} in {year}
            </span>
          )}
        </div>
      </div>
      {owed.length > 0 && (
        <Section title={`Owes you ${formatMoney(p.owes)}`}>
          {owed.map((i) => (
            <Row
              title={i.txn.payee}
              subtitle={formatDay(i.date)}
              detail={formatMoney(i.amount)}
              onClick={() => nav.present((close) => <TransactionEditor txn={i.txn} onClose={close} />)}
            />
          ))}
        </Section>
      )}
      <Section title="Payments">
        {p.txns.length ? (
          p.txns.map((t) => (
            <Row
              icon={<CategoryIcon category={cats.get(t.categoryId)} />}
              title={t.p2p?.note || cats.get(t.categoryId)?.name || t.payee}
              subtitle={`${appLabel(t)} · ${formatDay(t.date)}`}
              detail={<Money cents={t.amount} colored />}
              onClick={() => nav.present((close) => <TransactionEditor txn={t} onClose={close} />)}
            />
          ))
        ) : (
          <div class="row muted">No payments yet.</div>
        )}
      </Section>
    </Sheet>
  );
}

/**
 * Quick entry for a payment app payment (Apple Cash has no export; also handy right after paying).
 * Paid from a bank or card, it merges with the bank's line when that's imported, so nothing counts
 * twice.
 */
export function LogPayment(props: { onClose: () => void; app?: PaymentApp }) {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const categories = useCategories();
  const wallets = accounts.filter((a) => a.type === 'wallet' && !a.archived);
  const banks = accounts.filter((a) => !a.archived && (a.type === 'checking' || a.type === 'credit' || a.type === 'savings'));
  const [app, setApp] = useState<PaymentApp>(props.app ?? appOf(wallets[0]) ?? 'applecash');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO());
  const [categoryId, setCategoryId] = useState<string>(UNCATEGORIZED);
  const [touchedCategory, setTouchedCategory] = useState(false);
  const [fundedBy, setFundedBy] = useState<string>('balance');
  const [theyOwe, setTheyOwe] = useState(false);
  const names = useMemo(() => people(txns).map((p) => p.name), [txns]);
  const history = useMemo(() => payeeHistory(txns), [txns]);
  const cents = parseUserAmount(amount);

  // Suggest a category from the person and note as you type (until you pick one yourself).
  const guess = useMemo(() => {
    const signed = (cents ?? 0) * (direction === 'out' ? -1 : 1);
    const description = [APP_NAMES[app], person, note].filter(Boolean).join(' · ');
    const c = categorize({ description, payee: person, amount: signed, appPayment: true }, [], history);
    if (c.source !== 'default') return c.categoryId;
    return appFallback({ app, kind: 'payment', note }, signed)?.categoryId ?? UNCATEGORIZED;
  }, [app, person, note, direction, cents, history]);
  const category = touchedCategory ? categoryId : guess;

  const save = async () => {
    if (!cents || !person.trim()) return;
    const who = person.trim();
    const signed = direction === 'out' ? -cents : cents;
    await db.transaction('rw', db.accounts, db.transactions, async () => {
      let wallet: Account | undefined = (await db.accounts.toArray()).find((a) => a.type === 'wallet' && !a.archived && appOf(a) === app);
      if (!wallet) {
        wallet = {
          id: newId(),
          name: APP_NAMES[app],
          type: 'wallet',
          institution: APP_NAMES[app],
          openingBalance: 0,
          archived: false,
          createdAt: Date.now(),
        };
        await db.accounts.add(wallet);
      }
      const bank = direction === 'out' && fundedBy !== 'balance' ? accounts.find((a) => a.id === fundedBy) : undefined;
      const owe = direction === 'out' && theyOwe;
      const base: Transaction = {
        id: newId(),
        accountId: wallet.id,
        date,
        amount: signed,
        description: [APP_NAMES[app], who, note.trim()].filter(Boolean).join(' · '),
        payee: who,
        categoryId: owe ? OWED : category,
        categorySource: 'user',
        owedBy: owe ? who : undefined,
        notes: note.trim(),
        source: 'manual',
        createdAt: Date.now(),
        p2p: { app, person: who, note: note.trim() || undefined, kind: 'payment', fundedFrom: bank?.name },
      };
      if (!bank) {
        await db.transactions.add(base);
        return;
      }
      // Paid from the bank: the payment and the money in from the bank wait as a pair, and merge
      // into the bank's own line when it's there (now, or when you next import that bank).
      const ref = base.id;
      await db.transactions.bulkAdd([
        { ...base, p2p: { ...base.p2p!, role: 'payment', ref } },
        {
          ...base,
          id: newId(),
          amount: -signed,
          payee: `From ${bank.name}`,
          description: `${APP_NAMES[app]} · paid from ${bank.name}`,
          categoryId: TRANSFER,
          categorySource: 'rule',
          owedBy: undefined,
          notes: '',
          p2p: { app, role: 'funding', ref },
        },
      ]);
      const all = await db.transactions.toArray();
      const { update, remove } = linkWaitingPayments(all, await db.accounts.toArray());
      for (const u of update) await db.transactions.update(u.id, u.changes);
      await db.transactions.bulkDelete(remove);
    });
    nav.toast('Payment saved');
    props.onClose();
  };

  return (
    <Sheet title="Log a Payment" onClose={props.onClose} onSave={save} saveDisabled={!cents || !person.trim()}>
      <div class="amount-entry">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'out', label: 'I sent' },
            { value: 'in', label: 'I received' },
          ]}
        />
        <label class="big-amount">
          <span aria-hidden="true">{direction === 'out' ? '−$' : '+$'}</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount"
            value={amount}
            onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <Section>
        <Field label="App">
          <select value={app} onChange={(e) => setApp((e.target as HTMLSelectElement).value as PaymentApp)}>
            {(Object.keys(APP_NAMES) as PaymentApp[]).map((a) => (
              <option value={a}>{APP_NAMES[a]}</option>
            ))}
          </select>
        </Field>
        <Field label={direction === 'out' ? 'To' : 'From'}>
          <input list="app-people" value={person} placeholder="Who?" onInput={(e) => setPerson((e.target as HTMLInputElement).value)} />
          <datalist id="app-people">
            {names.map((n) => (
              <option value={n} />
            ))}
          </datalist>
        </Field>
        <Field label="Note">
          <input value={note} placeholder="🍕 pizza" onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        {direction === 'out' && (
          <Field
            label="Paid from"
            hint={fundedBy !== 'balance' ? 'It merges with the bank’s own line when you import that bank, so it isn’t counted twice.' : undefined}
          >
            <select value={fundedBy} onChange={(e) => setFundedBy((e.target as HTMLSelectElement).value)}>
              <option value="balance">{APP_NAMES[app]} balance</option>
              {banks.map((b) => (
                <option value={b.id}>{b.name}</option>
              ))}
            </select>
          </Field>
        )}
        {direction === 'out' && <Toggle checked={theyOwe} onChange={setTheyOwe} label="They’ll pay me back" />}
        {!(direction === 'out' && theyOwe) && (
          <Field label="Category">
            <CategorySelect
              categories={categories}
              value={category}
              onChange={(id) => {
                setCategoryId(id);
                setTouchedCategory(true);
              }}
            />
          </Field>
        )}
      </Section>
    </Sheet>
  );
}

function appOf(a: Account | undefined): PaymentApp | undefined {
  if (!a) return undefined;
  const text = `${a.institution} ${a.name}`.toLowerCase();
  if (/venmo/.test(text)) return 'venmo';
  if (/cash ?app/.test(text)) return 'cashapp';
  if (/apple/.test(text)) return 'applecash';
  return undefined;
}
