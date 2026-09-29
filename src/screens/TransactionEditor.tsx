import { useState } from 'preact/hooks';
import { db, newId, setMeta } from '../db';
import { useLoaded } from '../hooks';
import { useNav } from '../nav';
import type { Account, Category, Rule, Transaction } from '../types';
import { centsToInput, formatMoney, parseUserAmount } from '../lib/money';
import { todayISO } from '../lib/dates';
import { UNCATEGORIZED } from '../lib/categories';
import { ActionSheet, CategorySelect, Field, Section, Segmented, Sheet } from '../components/ui';
import { ExplainPanel } from '../components/ExplainPanel';

type Props = { txn?: Transaction; accountId?: string; onClose: () => void };

export function TransactionEditor(props: Props) {
  const data = useLoaded();
  if (!data) return null;
  const accounts = data.accounts.filter((a) => !a.archived || a.id === props.txn?.accountId);
  const fallback =
    accounts.find((a) => a.id === data.lastAccountId && !a.archived) ?? accounts.find((a) => a.type === 'checking' && !a.archived) ?? accounts[0];
  return <TransactionForm {...props} accounts={accounts} categories={data.categories} defaultAccountId={fallback?.id} />;
}

function TransactionForm(props: Props & { accounts: Account[]; categories: Category[]; defaultAccountId?: string }) {
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
  const [ask, setAsk] = useState<null | 'rule' | 'delete'>(null);

  const cents = parseUserAmount(amount);
  const valid = cents != null && cents > 0 && !!date && !!accountId && !!payee.trim();
  const category = categories.find((c) => c.id === categoryId);

  const save = async () => {
    if (!valid) return;
    const signed = direction === 'out' ? -cents! : cents!;
    const record: Transaction = {
      id: t?.id ?? newId(),
      accountId,
      date,
      amount: signed,
      description: t?.description ?? payee.trim(),
      payee: payee.trim(),
      categoryId,
      notes: notes.trim(),
      source: t?.source ?? 'manual',
      importId: t?.importId,
      createdAt: t?.createdAt ?? Date.now(),
    };
    await db.transactions.put(record);
    if (!t) await setMeta('lastManualAccount', accountId);
    // Offer to remember the choice when an imported transaction's category changes.
    if (t && t.source !== 'manual' && t.categoryId !== categoryId && categoryId !== UNCATEGORIZED) {
      setAsk('rule');
      return;
    }
    nav.toast(t ? 'Saved' : 'Transaction added');
    props.onClose();
  };

  const createRule = async (applyToPast: boolean) => {
    const match = payee.trim();
    const rule: Rule = { id: newId(), match, categoryId, createdAt: Date.now() };
    await db.rules.add(rule);
    let updated = 0;
    if (applyToPast) {
      const needle = match.toLowerCase();
      await db.transactions
        .filter((x) => x.id !== t!.id && x.categoryId !== categoryId && `${x.description}\n${x.payee}`.toLowerCase().includes(needle))
        .modify((x) => {
          x.categoryId = categoryId;
          updated++;
        });
    }
    nav.toast(updated ? `Rule saved · ${updated} more updated` : 'Rule saved');
    props.onClose();
  };

  const remove = async () => {
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
      <Section>
        <Field label="Payee">
          <input value={payee} placeholder="Who was it?" onInput={(e) => setPayee((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        </Field>
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
      </Section>
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
      {ask === 'rule' && (
        <ActionSheet
          title={`Always use ${category?.emoji ?? ''} ${category?.name ?? ''}?`}
          message={`Future imports that mention “${payee.trim()}” will be filed under ${category?.name}.`}
          actions={[
            { label: 'Yes, and Update Past Ones', bold: true, onClick: () => createRule(true) },
            { label: 'Yes, Future Imports Only', onClick: () => createRule(false) },
            { label: 'No, Just This One', onClick: () => props.onClose() },
          ]}
          onCancel={() => props.onClose()}
        />
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
