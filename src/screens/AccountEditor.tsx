import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useLoaded } from '../hooks';
import { useNav } from '../nav';
import type { Account, AccountType, Transaction } from '../types';
import { accountBalance, isLiability, openingBalanceFor } from '../lib/balances';
import { parseAmount } from '../lib/money';
import { ActionSheet, Field, Section, Sheet } from '../components/ui';

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'brokerage', label: 'Investment' },
  { value: 'cash', label: 'Cash' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

export const INSTITUTIONS = ['Citizens', 'Discover', 'Capital One', 'Fidelity'];

type Props = { account?: Account; onClose: () => void; onCreated?: (a: Account) => void };

export function AccountEditor(props: Props) {
  const data = useLoaded();
  return data ? <AccountForm {...props} txns={data.transactions} /> : null;
}

function AccountForm(props: Props & { txns: Transaction[] }) {
  const nav = useNav();
  const { txns } = props;
  const a = props.account;
  const current = a ? accountBalance(a, txns) : 0;
  const [name, setName] = useState(a?.name ?? '');
  const [type, setType] = useState<AccountType>(a?.type ?? 'checking');
  const [institution, setInstitution] = useState(a?.institution ?? '');
  const [last4, setLast4] = useState(a?.last4 ?? '');
  // Liabilities are entered as "amount owed" (positive) and stored negative.
  const [balance, setBalance] = useState(a ? ((isLiability(a) ? -current : current) / 100).toFixed(2) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const liability = isLiability({ type });
  const count = a ? txns.filter((t) => t.accountId === a.id).length : 0;

  const save = async () => {
    const entered = parseAmount(balance) ?? 0;
    const signed = liability ? -entered : entered;
    const record: Account = {
      id: a?.id ?? newId(),
      name: name.trim(),
      type,
      institution: institution.trim(),
      last4: last4.replace(/\D/g, '').slice(-4) || undefined,
      openingBalance: a ? a.openingBalance : 0,
      archived: a?.archived ?? false,
      createdAt: a?.createdAt ?? Date.now(),
    };
    record.openingBalance = openingBalanceFor(record.id, txns, signed);
    await db.accounts.put(record);
    nav.toast(a ? 'Account saved' : 'Account added');
    props.onCreated?.(record);
    props.onClose();
  };

  const remove = async () => {
    await db.transaction('rw', db.accounts, db.transactions, async () => {
      await db.transactions.where('accountId').equals(a!.id).delete();
      await db.accounts.delete(a!.id);
    });
    nav.toast('Account deleted');
    props.onClose();
  };

  const toggleArchive = async () => {
    await db.accounts.update(a!.id, { archived: !a!.archived });
    props.onClose();
  };

  return (
    <Sheet title={a ? 'Edit Account' : 'New Account'} onClose={props.onClose} onSave={save} saveDisabled={!name.trim()}>
      <Section>
        <Field label="Name">
          <input value={name} placeholder="e.g. Discover It" onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus={!a} />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Bank">
          <input list="institutions" value={institution} placeholder="Optional" onInput={(e) => setInstitution((e.target as HTMLInputElement).value)} />
          <datalist id="institutions">
            {INSTITUTIONS.map((i) => (
              <option value={i} />
            ))}
          </datalist>
        </Field>
        <Field label="Last 4 digits">
          <input inputMode="numeric" maxLength={4} value={last4} placeholder="Optional" onInput={(e) => setLast4((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      <Section
        title={liability ? 'Amount owed today' : 'Balance today'}
        footer={
          liability
            ? 'What you owe right now, as shown by your bank. Future transactions adjust it automatically.'
            : 'Your current balance, as shown by your bank. Future transactions adjust it automatically.'
        }
      >
        <Field label={liability ? 'Owed' : 'Balance'}>
          <input inputMode="decimal" value={balance} placeholder="0.00" onInput={(e) => setBalance((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      {a && (
        <Section>
          <button type="button" class="row link-row" onClick={() => nav.showActivity({ accountId: a.id })}>
            View {count} transaction{count === 1 ? '' : 's'}
          </button>
          <button type="button" class="row link-row" onClick={toggleArchive}>
            {a.archived ? 'Unhide account' : 'Hide account (closed)'}
          </button>
          <button type="button" class="row danger-row" onClick={() => setConfirmDelete(true)}>
            Delete Account
          </button>
        </Section>
      )}
      {confirmDelete && (
        <ActionSheet
          message={`Delete “${a!.name}” and its ${count} transaction${count === 1 ? '' : 's'}? This can't be undone.`}
          actions={[{ label: 'Delete Account', destructive: true, onClick: remove }]}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Sheet>
  );
}
