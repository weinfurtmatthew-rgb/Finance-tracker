import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useLoaded } from '../hooks';
import { useNav } from '../nav';
import type { Account, AccountType, Transaction, Valuation } from '../types';
import { useLiveQuery } from 'dexie-react-hooks';
import { isValued } from '../lib/networth';
import { formatShortDate, todayISO } from '../lib/dates';
import { BalanceCheckSheet } from '../components/BalanceCheck';
import { accountBalance, isLiability, openingBalanceFor } from '../lib/balances';
import { parseAmount } from '../lib/money';
import { ActionSheet, Field, Section, Sheet } from '../components/ui';

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'brokerage', label: 'Investment' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Payment app (Venmo, Cash App…)' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

export const INSTITUTIONS = ['Citizens', 'Discover', 'Capital One', 'Fidelity'];

type Props = { account?: Account; onClose: () => void; onCreated?: (a: Account) => void };

export function AccountEditor(props: Props) {
  const data = useLoaded();
  const lastValue = useLiveQuery(
    async () => (props.account ? ((await db.valuations.where('accountId').equals(props.account.id).sortBy('date')).at(-1) ?? null) : null),
    [props.account?.id],
  );
  return data && lastValue !== undefined ? <AccountForm {...props} txns={data.transactions} lastValue={lastValue} /> : null;
}

function AccountForm(props: Props & { txns: Transaction[]; lastValue: Valuation | null }) {
  const nav = useNav();
  const { txns, lastValue } = props;
  const a = props.account;
  const current = a ? (isValued(a) && lastValue ? lastValue.value : accountBalance(a, txns)) : 0;
  const [name, setName] = useState(a?.name ?? '');
  const [type, setType] = useState<AccountType>(a?.type ?? 'checking');
  const [institution, setInstitution] = useState(a?.institution ?? '');
  const [last4, setLast4] = useState(a?.last4 ?? '');
  // Liabilities are entered as "amount owed" (positive) and stored negative.
  const [balance, setBalance] = useState(a ? ((isLiability(a) ? -current : current) / 100).toFixed(2) : '');
  const [apr, setApr] = useState(a?.apr != null ? String(Math.round(a.apr * 10000) / 100) : '');
  const [minPayment, setMinPayment] = useState(a?.minPayment != null ? (a.minPayment / 100).toFixed(2) : '');
  const [apy, setApy] = useState(a?.apy != null ? String(Math.round(a.apy * 10000) / 100) : '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const liability = isLiability({ type });
  const valued = isValued({ type });
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
      ...(a?.checkedOn ? { checkedOn: a.checkedOn } : {}),
    };
    // Rates for the Plan calculators: APR & minimum on cards and loans, APY on bank accounts.
    const rate = (text: string) => {
      const n = parseFloat(text.replace('%', ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 10000 : undefined;
    };
    if (liability) {
      record.apr = rate(apr);
      const min = parseAmount(minPayment);
      record.minPayment = min != null ? Math.abs(min) : undefined;
    } else if (type === 'savings' || type === 'checking') record.apy = rate(apy);
    for (const k of ['apr', 'minPayment', 'apy'] as const) if (record[k] === undefined) delete record[k];
    if (valued) {
      // Investments & vehicles: record a dated value (a point in net worth history).
      await db.accounts.put(record);
      // Only a new or changed value is recorded, so renaming an account doesn't add a history point.
      const today = todayISO();
      if (!balance.trim()) {
        // No value entered (yet).
      } else if (lastValue?.date === today) await db.valuations.update(lastValue.id, { value: signed });
      else if (!lastValue || lastValue.value !== signed) await db.valuations.add({ id: newId(), accountId: record.id, date: today, value: signed });
    } else {
      record.openingBalance = openingBalanceFor(record.id, txns, signed);
      // Typing the bank's current balance here is a balance check too.
      if (balance.trim() && (!a || signed !== current)) record.checkedOn = todayISO();
      await db.accounts.put(record);
    }
    nav.toast(a ? 'Account saved' : 'Account added');
    props.onCreated?.(record);
    props.onClose();
  };

  const remove = async () => {
    await db.transaction('rw', db.accounts, db.transactions, db.valuations, db.goals, async () => {
      await db.transactions.where('accountId').equals(a!.id).delete();
      await db.valuations.where('accountId').equals(a!.id).delete();
      await db.goals.filter((g) => g.accountId === a!.id).delete();
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
        title={valued ? 'Value today' : liability ? 'Amount owed today' : 'Balance today'}
        footer={
          valued
            ? type === 'vehicle'
              ? 'A resale estimate (Kelley Blue Book, Edmunds or Carvana). Update it now and then; each update is a point in your net worth history.'
              : 'The total value shown on your brokerage’s site. Update it now and then; each update is a point in your net worth history.'
            : liability
              ? 'What you owe right now, as shown by your bank. Future transactions adjust it automatically.'
              : 'Your current balance, as shown by your bank. Future transactions adjust it automatically.'
        }
      >
        <Field label={valued ? 'Value' : liability ? 'Owed' : 'Balance'}>
          <input inputMode="decimal" value={balance} placeholder="0.00" onInput={(e) => setBalance((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      {liability && (
        <Section title="Interest" footer="Optional. Used by the debt payoff and affordability calculators; without them, typical rates are assumed.">
          <Field label="APR">
            <input inputMode="decimal" value={apr} placeholder="e.g. 24.99" onInput={(e) => setApr((e.target as HTMLInputElement).value)} />
            <span class="affix">%</span>
          </Field>
          <Field label="Minimum / mo">
            <input inputMode="decimal" value={minPayment} placeholder="0.00" onInput={(e) => setMinPayment((e.target as HTMLInputElement).value)} />
          </Field>
        </Section>
      )}
      {(type === 'savings' || type === 'checking') && (
        <Section title="Interest" footer="Optional. The yearly yield your bank shows (APY), used by the savings calculator.">
          <Field label="APY">
            <input inputMode="decimal" value={apy} placeholder="e.g. 4.10" onInput={(e) => setApy((e.target as HTMLInputElement).value)} />
            <span class="affix">%</span>
          </Field>
        </Section>
      )}
      {a && (
        <Section>
          {!valued && (
            <button type="button" class="row link-row" onClick={() => nav.present((close) => <BalanceCheckSheet account={a} onClose={close} />)}>
              Check balance against my bank{a.checkedOn ? ` · last matched ${formatShortDate(a.checkedOn)}` : ''}
            </button>
          )}
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
