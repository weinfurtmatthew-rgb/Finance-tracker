import { useMemo, useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useAccounts, useCategories } from '../hooks';
import { useNav } from '../nav';
import type { AmountMode, Frequency, Recurring, RecurringKind } from '../types';
import { addDays, dayOfMonth, formatDay, todayISO } from '../lib/dates';
import { centsToInput, parseUserAmount } from '../lib/money';
import { FREQUENCIES, KINDS, matchesRecurring, previousOnSchedule, type RecurringStatus } from '../lib/recurring';
import { cancelLinkFor } from '../lib/cancelLinks';
import { useStore } from '../store';
import { CategorySelect, Field, Money, Row, Section, Sheet, Toggle } from '../components/ui';

/** Kinds with a set price: a new one only counts charges close to its amount, so a store's other purchases don't. */
const FIXED_PRICE = new Set<RecurringKind>(['subscription', 'trial', 'loan']);
/** How many matched charges the editor lists. */
const PREVIEW = 5;

const MODES: { value: AmountMode | ''; label: string }[] = [
  { value: '', label: 'Use default (Settings)' },
  { value: 'average', label: 'Average of last 3' },
  { value: 'last', label: 'Same as last charge' },
  { value: 'manual', label: 'Always the amount above' },
];

export function RecurringEditor(props: { recurring?: Recurring; status?: RecurringStatus; onClose: () => void; initialKind?: RecurringKind }) {
  const nav = useNav();
  const accounts = useAccounts();
  const categories = useCategories();
  const r = props.recurring;
  const [name, setName] = useState(r?.name ?? '');
  const [kind, setKind] = useState<RecurringKind>(r?.kind ?? props.initialKind ?? 'subscription');
  const [frequency, setFrequency] = useState<Frequency>(r?.frequency ?? 'monthly');
  const [amount, setAmount] = useState(r ? centsToInput(r.amount) : '');
  const [mode, setMode] = useState<AmountMode | ''>(r?.amountMode ?? '');
  const [nextDue, setNextDue] = useState(props.status?.nextDue ?? addDays(todayISO(), 7));
  const [dayA, setDayA] = useState(String(r?.days?.[0] ?? 1));
  const [dayB, setDayB] = useState(String(r?.days?.[1] ?? 15));
  const [trialEndsOn, setTrialEndsOn] = useState(r?.trialEndsOn ?? addDays(todayISO(), 7));
  const [match, setMatch] = useState(r?.match ?? '');
  const [useMatchAmount, setUseMatchAmount] = useState(r ? r.matchAmount != null : FIXED_PRICE.has(props.initialKind ?? 'subscription'));
  const [amountTouched, setAmountTouched] = useState(false);
  const [showName, setShowName] = useState<boolean | undefined>(r?.showName);
  const [accountId, setAccountId] = useState(r?.accountId ?? '');
  const [categoryId, setCategoryId] = useState(r?.categoryId ?? '');
  const [cancelUrl, setCancelUrl] = useState(r?.cancelUrl ?? '');

  const cents = parseUserAmount(amount);
  const valid = !!name.trim() && cents != null && cents > 0;
  const trial = kind === 'trial';
  const signedCents = cents != null && cents > 0 ? (kind === 'income' ? cents : -cents) : undefined;
  const matchText = (match.trim() || name.trim()).toLowerCase();
  // A name that isn't the words matched ("Apple Music", matching "apple") can be shown on the charges instead.
  const named = !!match.trim() && match.trim().toLowerCase() !== name.trim().toLowerCase();
  const showsName = named && (showName ?? !r);

  // What this would count as payments, as you type.
  const store = useStore();
  const txns = store.raw.transactions;
  const matched = useMemo(() => {
    if (!txns || !matchText) return [];
    const draft = { kind, match: matchText, matchAmount: useMatchAmount ? signedCents : undefined } as Recurring;
    return txns.filter((t) => matchesRecurring(draft, t)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [txns, kind, matchText, useMatchAmount, signedCents]);

  const changeKind = (k: RecurringKind) => {
    setKind(k);
    // A new bill that varies (electric) takes any amount; a subscription only its price. Until you choose.
    if (!r && !amountTouched) setUseMatchAmount(FIXED_PRICE.has(k));
  };

  const save = async () => {
    if (!valid) return;
    const signed = signedCents!;
    const schedule = {
      frequency,
      dayOfMonth: FREQUENCIES[frequency].months ? dayOfMonth(trial ? trialEndsOn : nextDue) : undefined,
      days: frequency === 'semimonthly' ? ([Number(dayA) || 1, Number(dayB) || 15].sort((a, b) => a - b) as [number, number]) : undefined,
    };
    const record: Recurring = {
      id: r?.id ?? newId(),
      name: name.trim(),
      kind,
      ...schedule,
      match: matchText,
      matchAmount: useMatchAmount ? (r?.matchAmount && Math.sign(r.matchAmount) === Math.sign(signed) ? r.matchAmount : signed) : undefined,
      showName: showsName || undefined,
      amount: signed,
      amountMode: mode || undefined,
      // Store the due date as "the payment before it", so imports that arrive later take over naturally.
      lastPaidOn: trial ? r?.lastPaidOn : nextDue === props.status?.nextDue ? r?.lastPaidOn : previousOnSchedule(nextDue, schedule),
      accountId: accountId || undefined,
      categoryId: categoryId || undefined,
      status: r?.status ?? 'active',
      cancelledOn: r?.cancelledOn,
      cancelUrl: cancelUrl.trim() || undefined,
      trialEndsOn: trial ? trialEndsOn : undefined,
      notes: r?.notes,
      createdAt: r?.createdAt ?? Date.now(),
    };
    await db.recurring.put(record);
    nav.toast(r ? 'Saved' : 'Added');
    props.onClose();
  };

  return (
    <Sheet title={r ? 'Edit' : 'New Bill or Subscription'} onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section>
        <Field label="Name">
          <input value={name} placeholder="e.g. Netflix" onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus={!r} />
        </Field>
        <Field label="Type">
          <select value={kind} onChange={(e) => changeKind((e.target as HTMLSelectElement).value as RecurringKind)}>
            {(Object.keys(KINDS) as RecurringKind[]).map((k) => (
              <option value={k}>{KINDS[k].label}</option>
            ))}
          </select>
        </Field>
        <Field label={kind === 'income' ? 'Amount' : trial ? 'Price after trial' : 'Amount'}>
          <input inputMode="decimal" placeholder="0.00" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="How often">
          <select value={frequency} onChange={(e) => setFrequency((e.target as HTMLSelectElement).value as Frequency)}>
            {(Object.keys(FREQUENCIES) as Frequency[]).map((f) => (
              <option value={f}>{FREQUENCIES[f].label}</option>
            ))}
          </select>
        </Field>
        {trial ? (
          <Field label="Trial ends">
            <input type="date" value={trialEndsOn} onInput={(e) => setTrialEndsOn((e.target as HTMLInputElement).value)} />
          </Field>
        ) : (
          <Field label="Next due">
            <input type="date" value={nextDue} onInput={(e) => setNextDue((e.target as HTMLInputElement).value)} />
          </Field>
        )}
        {frequency === 'semimonthly' && (
          <>
            <Field label="First day">
              <input inputMode="numeric" value={dayA} onInput={(e) => setDayA((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Second day">
              <input inputMode="numeric" value={dayB} onInput={(e) => setDayB((e.target as HTMLInputElement).value)} />
            </Field>
          </>
        )}
      </Section>

      <Section title="Predicting the amount" footer="For bills that change, like electric. The default is set in Settings.">
        <Field label="Expect">
          <select value={mode} onChange={(e) => setMode((e.target as HTMLSelectElement).value as AmountMode | '')}>
            {MODES.map((m) => (
              <option value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section
        title="Matching"
        footer="Imported transactions with these words in their name or description count as payments. Limit by amount when one company bills several things, like Apple."
      >
        <Field label="Contains">
          <input value={match} placeholder={name.toLowerCase() || 'text'} onInput={(e) => setMatch((e.target as HTMLInputElement).value)} />
        </Field>
        <Toggle
          checked={useMatchAmount}
          onChange={(on) => {
            setUseMatchAmount(on);
            setAmountTouched(true);
          }}
          label="Only amounts close to this one"
        />
        {named && <Toggle checked={showsName} onChange={setShowName} label={`Show “${name.trim()}” on its transactions`} />}
      </Section>

      {matchText && (
        <Section
          title={matched.length ? `Matches ${matched.length} transaction${matched.length === 1 ? '' : 's'}` : 'No matches yet'}
          footer={
            matched.length
              ? matched.length > PREVIEW
                ? `The latest ${PREVIEW} are shown. Too many? Use more of the name, or turn on Only amounts close to this one.`
                : undefined
              : /^apple\b/.test(matchText) && matchText !== 'apple'
                ? 'Apple subscriptions come in as “Apple”: type apple under Contains, and keep Only amounts close to this one on.'
                : 'Charges count once they’re imported. Nothing imported so far has these words.'
          }
        >
          {matched.slice(0, PREVIEW).map((t) => (
            <Row title={t.payee || t.description} subtitle={formatDay(t.date)} detail={<Money cents={t.amount} />} />
          ))}
        </Section>
      )}

      <Section>
        <Field label={kind === 'income' ? 'Paid into' : 'Paid from'}>
          <select value={accountId} onChange={(e) => setAccountId((e.target as HTMLSelectElement).value)}>
            <option value="">—</option>
            {accounts.map((a) => (
              <option value={a.id}>{a.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <CategorySelect
            categories={[{ id: '', name: 'Automatic', emoji: '', color: '', group: 'expense', order: -1 }, ...categories]}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
        {kind !== 'income' && kind !== 'card-payment' && (
          <Field label="Cancel link">
            <input type="url" value={cancelUrl} placeholder={cancelLinkFor(name, match) ?? 'https://…'} onInput={(e) => setCancelUrl((e.target as HTMLInputElement).value)} />
          </Field>
        )}
      </Section>
    </Sheet>
  );
}
