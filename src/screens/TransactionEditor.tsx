import { useMemo, useState } from 'preact/hooks';
import { db, newId, setMeta } from '../db';
import { isTrusted, payeeKey } from '../lib/categorize';
import { useLoaded } from '../hooks';
import { useNav } from '../nav';
import type { Account, Category, Transaction } from '../types';
import { centsToInput, formatMoney, parseUserAmount } from '../lib/money';
import { todayISO } from '../lib/dates';
import { OWED, UNCATEGORIZED } from '../lib/categories';
import { allTags, owedItems, splitProblem } from '../lib/lines';
import { SplitEditor, partCents, type PartDraft } from '../components/SplitEditor';
import { TagInput } from '../components/TagInput';
import { SettleSheet } from './Owed';
import { ActionSheet, CategorySelect, Field, Section, Segmented, Sheet, Toggle } from '../components/ui';
import { ExplainPanel } from '../components/ExplainPanel';
import { APP_NAMES, bankLineApp, isAppTransferLine } from '../lib/p2p';

/**
 * Keep payment-app details. On an app payment (or a bank line like "APPLE CASH SENT MONEY"), the payee
 * you type is the person, so it shows up under People.
 */
function appDetails(t: Transaction | undefined, payee: string): Pick<Transaction, 'p2p'> | Record<string, never> {
  if (!t) return {};
  const app = t.p2p?.app ?? bankLineApp(t.description);
  if (!app) return {};
  const isPayment = t.p2p ? t.p2p.kind === 'payment' && t.p2p.role !== 'funding' : !isAppTransferLine(t.description);
  if (!t.p2p && (!isPayment || payee === t.payee)) return {};
  return { p2p: { ...(t.p2p ?? { app, kind: 'payment' }), ...(isPayment && payee ? { person: payee } : {}) } };
}

type Props = { txn?: Transaction; accountId?: string; onClose: () => void };

export function TransactionEditor(props: Props) {
  const data = useLoaded();
  if (!data) return null;
  const accounts = data.accounts.filter((a) => !a.archived || a.id === props.txn?.accountId);
  const fallback =
    accounts.find((a) => a.id === data.lastAccountId && !a.archived) ?? accounts.find((a) => a.type === 'checking' && !a.archived) ?? accounts[0];
  return <TransactionForm {...props} accounts={accounts} categories={data.categories} txns={data.transactions} defaultAccountId={fallback?.id} />;
}

function TransactionForm(props: Props & { accounts: Account[]; categories: Category[]; txns: Transaction[]; defaultAccountId?: string }) {
  const nav = useNav();
  const { accounts, categories } = props;
  const t = props.txn;
  const [direction, setDirection] = useState<'out' | 'in'>(t && t.amount > 0 ? 'in' : 'out');
  const [amount, setAmount] = useState(t ? centsToInput(t.amount) : '');
  const [date, setDate] = useState(t?.date ?? todayISO());
  const [payee, setPayee] = useState(t?.payee ?? '');
  const [accountId, setAccountId] = useState(t?.accountId ?? props.accountId ?? props.defaultAccountId ?? '');
  const [categoryId, setCategoryId] = useState(t?.categoryId ?? UNCATEGORIZED);
  const [notes, setNotes] = useState(t?.notes ?? '');
  const [ask, setAsk] = useState<null | 'delete'>(null);
  const [alsoOthers, setAlsoOthers] = useState(true);
  const [parts, setParts] = useState<PartDraft[] | null>(() =>
    t?.splits?.length
      ? t.splits.map((p) => ({ id: p.id, amount: centsToInput(p.amount), categoryId: p.categoryId, forSomeone: !!p.owedBy, owedBy: p.owedBy ?? '', settledBy: p.settledBy }))
      : null,
  );
  const [forSomeone, setForSomeone] = useState(!!t?.owedBy);
  const [owedBy, setOwedBy] = useState(t?.owedBy ?? '');
  const [tags, setTags] = useState<string[]>(t?.tags ?? []);
  const knownTags = useMemo(() => allTags(props.txns).map((x) => x.tag), [props.txns]);
  const people = useMemo(() => [...new Set([...owedItems(props.txns).map((i) => i.who), ...props.txns.map((x) => x.p2p?.person).filter((x): x is string => !!x && !x.includes('*'))])], [props.txns]);
  const owedHere = t ? owedItems([t]) : [];

  const cents = parseUserAmount(amount);
  const sign = direction === 'out' ? -1 : 1;
  const splitError = parts ? splitProblem(cents ?? 0, parts.map((p) => ({ amount: partCents(p), categoryId: p.categoryId }))) : null;
  const owedMissing = (forSomeone && !parts && !owedBy.trim()) || !!parts?.some((p) => p.forSomeone && !p.owedBy.trim());
  const valid = cents != null && cents > 0 && !!date && !!accountId && !!payee.trim() && !splitError && !owedMissing;
  const changed = !!t && t.categoryId !== categoryId && categoryId !== UNCATEGORIZED;
  // Same payee, same direction of money, still on a guessed category: fixing one fixes them all.
  const others = changed
    ? props.txns.filter(
        (x) => x.id !== t!.id && payeeKey(x.payee) === payeeKey(t!.payee) && x.amount > 0 === t!.amount > 0 && x.categoryId !== categoryId && !isTrusted(x),
      )
    : [];

  const startSplit = () =>
    setParts([
      { id: newId(), amount: amount || '', categoryId: categoryId === OWED ? UNCATEGORIZED : categoryId, forSomeone: false, owedBy: '' },
      { id: newId(), amount: '', categoryId: UNCATEGORIZED, forSomeone: false, owedBy: '' },
    ]);
  const addPart = () => setParts([...(parts ?? []), { id: newId(), amount: '', categoryId: UNCATEGORIZED, forSomeone: false, owedBy: '' }]);

  const save = async () => {
    if (!valid) return;
    const signed = sign * cents!;
    const whole = forSomeone && !parts && direction === 'out';
    const splits = parts?.map((p) => ({
      id: p.id,
      amount: sign * partCents(p),
      categoryId: p.forSomeone ? OWED : p.categoryId,
      ...(p.forSomeone ? { owedBy: p.owedBy.trim(), ...(p.settledBy ? { settledBy: p.settledBy } : {}) } : {}),
    }));
    const record: Transaction = {
      id: t?.id ?? newId(),
      accountId,
      date,
      amount: signed,
      description: t?.description ?? payee.trim(),
      payee: payee.trim(),
      // A split transaction is filed under its biggest part (the parts are what count).
      categoryId: splits ? [...splits].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0].categoryId : whole ? OWED : categoryId,
      // Choosing (or re-saving) a category yourself makes it one the AI learns from most.
      categorySource: categoryId === UNCATEGORIZED ? undefined : !t || changed || t.categorySource === 'ai' ? 'user' : t.categorySource,
      notes: notes.trim(),
      source: t?.source ?? 'manual',
      importId: t?.importId,
      createdAt: t?.createdAt ?? Date.now(),
      ...(splits ? { splits } : {}),
      ...(tags.length ? { tags } : {}),
      ...appDetails(t, payee.trim()),
      ...(whole ? { owedBy: owedBy.trim(), ...(t?.settledBy ? { settledBy: t.settledBy } : {}) } : {}),
    };
    if (!record.categorySource) delete record.categorySource;
    await db.transactions.put(record);
    if (!t) await setMeta('lastManualAccount', accountId);
    if (changed && alsoOthers && others.length) {
      await db.transactions.bulkUpdate(others.map((x) => ({ key: x.id, changes: { categoryId, categorySource: 'user' as const } })));
      nav.toast(`Saved · ${others.length} more updated`);
    } else nav.toast(t ? 'Saved' : 'Transaction added');
    props.onClose();
  };

  const remove = async () => {
    // A payment waiting for its bank line goes together with the money in from the bank.
    const ref = t!.p2p?.ref;
    if (ref) await db.transactions.bulkDelete(props.txns.filter((x) => x.p2p?.ref === ref).map((x) => x.id));
    await db.transactions.delete(t!.id);
    nav.toast('Transaction deleted');
    props.onClose();
  };

  if (accounts.length === 0) {
    return (
      <Sheet title="New Transaction" onClose={props.onClose}>
        <p class="padded muted">Add an account first (Accounts tab), then you can add transactions to it.</p>
      </Sheet>
    );
  }

  return (
    <Sheet title={t ? 'Transaction' : 'New Transaction'} onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <div class="amount-entry">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'out', label: 'Money out' },
            { value: 'in', label: 'Money in' },
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
            autoFocus={!t}
          />
        </label>
      </div>
      {t?.p2p && t.p2p.role !== 'funding' && (
        <p class="section-footer intro">
          {[
            APP_NAMES[t.p2p.app],
            t.p2p.person,
            t.p2p.note && `“${t.p2p.note}”`,
            t.p2p.fundedFrom && `paid from ${t.p2p.fundedFrom}`,
            t.p2p.appImportId && 'matched to your bank’s line',
            t.p2p.role === 'payment' && 'waiting for your bank’s line',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <Section>
        <Field label="Payee">
          <input value={payee} placeholder="Who was it?" onInput={(e) => setPayee((e.target as HTMLInputElement).value)} />
        </Field>
        {!parts && !(forSomeone && direction === 'out') && (
          <Field label="Category">
            <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
          </Field>
        )}
        {!parts && direction === 'out' && <Toggle checked={forSomeone} onChange={setForSomeone} label="Paid for someone else" />}
        {!parts && forSomeone && direction === 'out' && (
          <Field label="Who owes you">
            <input list="owed-people-main" value={owedBy} placeholder="e.g. Alex, Work" onInput={(e) => setOwedBy((e.target as HTMLInputElement).value)} />
            <datalist id="owed-people-main">
              {people.map((p) => (
                <option value={p} />
              ))}
            </datalist>
          </Field>
        )}
        {!parts && (
          <button type="button" class="row link-row" onClick={startSplit}>
            Split into parts…
          </button>
        )}
        <Field label="Date">
          <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId((e.target as HTMLSelectElement).value)}>
            {accounts.map((a) => (
              <option value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input value={notes} placeholder="Optional" onInput={(e) => setNotes((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Tags">
          <TagInput tags={tags} known={knownTags} onChange={setTags} />
        </Field>
      </Section>
      {parts && (
        <SplitEditor
          total={cents ?? 0}
          parts={parts}
          onChange={setParts}
          onAddPart={addPart}
          onRemoveSplit={() => setParts(null)}
          categories={categories}
          people={people}
          money={direction}
        />
      )}
      {parts && splitError && !splitError.startsWith('Parts add up') && <p class="section-footer intro warn-text">{splitError}</p>}
      {owedHere.length > 0 && (
        <Section title="Paid back?">
          {owedHere.map((i) => (
            <button type="button" class="row" onClick={() => nav.present((close) => <SettleSheet item={i} onClose={close} />)}>
              <span class="row-main">
                <span class="row-title">
                  {i.who} · {formatMoney(i.amount)}
                </span>
                <span class="row-subtitle">{i.settledBy ? 'Paid back ✓' : 'Not paid back yet'}</span>
              </span>
              <span class="row-detail">{i.settledBy ? 'Change' : 'Mark paid back'}</span>
            </button>
          ))}
        </Section>
      )}
      {others.length > 0 && (
        <Section footer={`Future imports from ${t!.payee} will use ${categories.find((c) => c.id === categoryId)?.name ?? 'it'} too.`}>
          <Toggle
            checked={alsoOthers}
            onChange={setAlsoOthers}
            label={`Also change ${others.length} other ${t!.payee} transaction${others.length === 1 ? '' : 's'}`}
          />
        </Section>
      )}
      {t && t.source !== 'manual' && (
        <Section title="From your bank" footer={`Imported from a ${t.source.toUpperCase()} file.`}>
          <div class="row">
            <span class="row-main">
              <span class="row-title mono">{t.description}</span>
            </span>
          </div>
          <ExplainPanel txn={t} categories={categories} onUseName={setPayee} onUseCategory={setCategoryId} />
        </Section>
      )}
      {t && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setAsk('delete')}>
            Delete Transaction
          </button>
        </Section>
      )}
      {ask === 'delete' && (
        <ActionSheet
          message={`Delete ${payee || 'this transaction'} (${formatMoney(t!.amount)})? This can't be undone.`}
          actions={[{ label: 'Delete Transaction', destructive: true, onClick: remove }]}
          onCancel={() => setAsk(null)}
        />
      )}
    </Sheet>
  );
}
