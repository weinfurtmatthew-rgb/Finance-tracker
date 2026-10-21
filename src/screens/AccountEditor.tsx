import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useLoaded } from '../hooks';
import { useNav } from '../nav';
import type { Account, AccountType, Transaction, Valuation } from '../types';
import { useLiveQuery } from 'dexie-react-hooks';
import { isValued } from '../lib/networth';
import { isIra } from '../lib/ira';
import { formatDate, formatShortDate, todayISO } from '../lib/dates';
import { CD_TERMS, cdValueOn, maturityDate, termLabel, termMonths } from '../lib/cd';
import { BalanceCheckSheet } from '../components/BalanceCheck';
import { accountBalance, isLiability, openingBalanceFor } from '../lib/balances';
import { formatMoney, parseAmount } from '../lib/money';
import { ActionSheet, Field, Section, Sheet, Toggle } from '../components/ui';

export const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit card' },
  { value: 'brokerage', label: 'Investment' },
  { value: 'cd', label: 'CD' },
  { value: 'roth-ira', label: 'Roth IRA' },
  { value: 'ira', label: 'Traditional IRA' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Payment app (Venmo, Cash App…)' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
];

/** A type's short name for naming an account: "Payment app", not "Payment app (Venmo, Cash App…)". */
export const typeName = (type: AccountType) => (ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? '').replace(/\s*\(.*\)$/, '');

export const INSTITUTIONS = ['Citizens', 'Discover', 'Capital One', 'Fidelity'];

type Props = { account?: Account; onClose: () => void; onCreated?: (a: Account) => void };

export function AccountEditor(props: Props) {
  const data = useLoaded();
  const values = useLiveQuery(
    async () => (props.account ? await db.valuations.where('accountId').equals(props.account.id).sortBy('date') : []),
    [props.account?.id],
  );
  return data && values !== undefined ? <AccountForm {...props} txns={data.transactions} values={values} /> : null;
}

/** "10000", "10,000.50" → cents; undefined unless it's an amount above zero. */
const positive = (text: string) => {
  const c = parseAmount(text);
  return c != null && c !== 0 ? Math.abs(c) : undefined;
};

function AccountForm(props: Props & { txns: Transaction[]; values: Valuation[] }) {
  const nav = useNav();
  const { txns, values } = props;
  const lastValue = values.at(-1) ?? null;
  const a = props.account;
  // An IRA is its last value plus what's been contributed since (see lib/networth.ts).
  const contributedSince =
    a && isIra(a)
      ? txns.filter((t) => t.accountId === a.id && t.contributionYear != null && (!lastValue || t.date > lastValue.date)).reduce((s, t) => s + t.amount, 0)
      : 0;
  const current = a ? (isValued(a) && lastValue ? lastValue.value + contributedSince : accountBalance(a, txns)) : 0;
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

  // CDs: what went in when the current term started, the term and the rate; the value grows from there.
  const isCd = type === 'cd';
  const today = todayISO();
  const termStart = a?.type === 'cd' && a.openedOn ? values.find((v) => v.date === a.openedOn) : undefined;
  const [deposit, setDeposit] = useState(termStart ? (termStart.value / 100).toFixed(2) : '');
  const [openedOn, setOpenedOn] = useState(a?.openedOn ?? today);
  const [termChoice, setTermChoice] = useState(() => {
    const m = a?.openedOn && a.maturesOn ? termMonths(a.openedOn, a.maturesOn) : 12;
    return m && CD_TERMS.includes(m) ? String(m) : a?.maturesOn ? 'other' : '12';
  });
  const [otherDate, setOtherDate] = useState(a?.maturesOn ?? '');
  const [paidOut, setPaidOut] = useState(!!a?.interestPaidOut);
  const maturesOn = termChoice === 'other' ? otherDate : maturityDate(openedOn || today, Number(termChoice));
  const depositCents = positive(deposit);
  const cdValid = !!depositCents && !!openedOn && !!maturesOn && maturesOn > openedOn;
  // A CD that came in from a bank file can keep its balance from its transactions until you add its terms.
  const cdTerms = isCd && (!a || !!termStart || deposit.trim() !== '');
  const rate = (text: string) => {
    const n = parseFloat(text.replace('%', ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 10000 : undefined;
  };
  const estimate = (date: string) =>
    cdValueOn({ apy: rate(apy), maturesOn, interestPaidOut: paidOut }, [{ id: '', accountId: '', date: openedOn, value: depositCents ?? 0 }], date);
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
      ...(a?.balanceSetAt ? { balanceSetAt: a.balanceSetAt } : {}),
      ...(a?.closedOn ? { closedOn: a.closedOn } : {}),
    };
    // Rates for the Plan calculators: APR & minimum on cards and loans, APY on bank accounts.
    if (cdTerms) {
      record.apy = rate(apy);
      record.openedOn = openedOn;
      record.maturesOn = maturesOn;
      if (paidOut) record.interestPaidOut = true;
      if (record.apy === undefined) delete record.apy;
      // The deposit is the CD's value on the day the term started; it grows from there (lib/cd.ts).
      await db.transaction('rw', db.accounts, db.valuations, async () => {
        await db.accounts.put(record);
        if (termStart) await db.valuations.update(termStart.id, { date: openedOn, value: depositCents! });
        else await db.valuations.add({ id: newId(), accountId: record.id, date: openedOn, value: depositCents! });
      });
      nav.toast(a ? 'Account saved' : 'CD added');
      props.onCreated?.(record);
      props.onClose();
      return;
    }
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
      else if (!lastValue || signed !== current) await db.valuations.add({ id: newId(), accountId: record.id, date: today, value: signed });
    } else {
      record.openingBalance = openingBalanceFor(record.id, txns, signed);
      // Typing the bank's current balance here is a balance check too.
      if (balance.trim() && (!a || signed !== current)) {
        record.checkedOn = todayISO();
        record.balanceSetAt = Date.now();
      }
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
    // Showing a cashed-out CD again brings back its full history (and its value since).
    await db.accounts.update(a!.id, { archived: !a!.archived, ...(a!.archived ? { closedOn: undefined } : {}) });
    props.onClose();
  };

  return (
    <Sheet title={a ? 'Edit Account' : 'New Account'} onClose={props.onClose} onSave={save} saveDisabled={!name.trim() || (cdTerms && !cdValid)}>
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
      {isCd ? (
        <Section
          title="CD"
          footer={
            !cdValid
              ? `What you deposited, when, and for how long. Your bank’s site or statement shows these. For a CD that renewed, use the day it renewed and what it was worth then.${cdTerms ? '' : ' Leave them empty to keep its balance from its imported transactions.'}`
              : openedOn > today
                ? `Starts ${formatDate(openedOn)} and grows to about ${formatMoney(estimate(maturesOn))} by ${formatDate(maturesOn)}.`
                : `Worth about ${formatMoney(estimate(today))} today${maturesOn > today ? `, and ${formatMoney(estimate(maturesOn))} when it matures ${formatDate(maturesOn)}` : ''}. It grows on its own; there’s no value to update.`
          }
        >
          <Field label="Deposit">
            <input inputMode="decimal" value={deposit} placeholder="0.00" onInput={(e) => setDeposit((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Opened">
            <input type="date" value={openedOn} onInput={(e) => setOpenedOn((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Term" hint={termChoice !== 'other' && openedOn ? `Matures ${formatDate(maturesOn)}` : undefined}>
            <select value={termChoice} onChange={(e) => setTermChoice((e.target as HTMLSelectElement).value)}>
              {CD_TERMS.map((m) => (
                <option value={String(m)}>{termLabel(m)}</option>
              ))}
              <option value="other">Other date…</option>
            </select>
          </Field>
          {termChoice === 'other' && (
            <Field label="Matures">
              <input type="date" value={otherDate} min={openedOn} onInput={(e) => setOtherDate((e.target as HTMLInputElement).value)} />
            </Field>
          )}
          <Field label="APY">
            <input inputMode="decimal" value={apy} placeholder="e.g. 4.50" onInput={(e) => setApy((e.target as HTMLInputElement).value)} />
            <span class="affix">%</span>
          </Field>
          <Toggle label="Interest goes to another account" checked={paidOut} onChange={setPaidOut} />
        </Section>
      ) : (
        <Section
          title={valued ? 'Value today' : liability ? 'Amount owed today' : 'Balance today'}
          footer={
            valued
              ? type === 'vehicle'
                ? 'A resale estimate (Kelley Blue Book, Edmunds or Carvana). Update it now and then; each update is a point in your net worth history.'
                : isIra({ type })
                  ? 'The total value shown on your brokerage’s site today. Contributions dated after today count on top of it until you next update it.'
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
      )}
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
          {!valued && !(isCd && termStart) && (
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
