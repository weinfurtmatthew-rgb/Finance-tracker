import { useState } from 'preact/hooks';
import { db, newId, setMeta } from '../db';
import { byId, useAccounts, useBook, useCategories, useMeta, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account, Transaction } from '../types';
import { iraRoom, isIra, taxYearsFor, type SpottedContribution } from '../lib/ira';
import { formatDate, formatDay, todayISO } from '../lib/dates';
import { formatMoney, parseUserAmount } from '../lib/money';
import { Empty, Field, Row, Section, Segmented, Sheet } from '../components/ui';
import { IRA_REVIEWED, useBirthYear, useIraSpots } from '../iraModel';
import { TransactionEditor } from './TransactionEditor';

const whole = (c: number) => formatMoney(c, { whole: true });
/** Where contributions go: Investments is a transfer category, so moving money into an IRA is never "spending". */
const INVESTMENTS = 'investments';

/** How much has gone in for each open tax year, across all your IRAs, against the IRS limit. */
export function IraRoomMeters(props: { txns: Transaction[]; today: string }) {
  const birthYear = useBirthYear();
  return (
    <>
      {taxYearsFor(props.today).map((year) => {
        const r = iraRoom(year, props.txns, birthYear);
        return (
          <div class="meter-row ira-room">
            <span class="meter-head">
              <span>{year} contributions</span>
              <span class="muted">
                {whole(r.contributed)} of {whole(r.limit)}
              </span>
            </span>
            <span
              class="meter-track"
              role="meter"
              aria-label={`${year} IRA contributions`}
              aria-valuemin={0}
              aria-valuemax={r.limit / 100}
              aria-valuenow={r.contributed / 100}
            >
              <span class="meter-fill" style={{ width: `${Math.min(100, (r.contributed / r.limit) * 100)}%` }} />
            </span>
            <span class="meter-sub">
              {r.left > 0 ? `${whole(r.left)} left · contribute by ${formatDate(r.deadline)}` : 'Limit reached'}
              {r.estimated ? ` · the ${year} limit isn’t announced yet, so last year’s is used` : ''}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** Your birth year, saved as you type it (four digits). */
export function BirthYearField() {
  const birthYear = useBirthYear();
  const [text, setText] = useState(birthYear ? String(birthYear) : '');
  const thisYear = Number(todayISO().slice(0, 4));
  const save = (v: string) => {
    setText(v);
    const n = Number(v);
    if (/^\d{4}$/.test(v) && n > thisYear - 110 && n <= thisYear) void setMeta('birthYear', n);
  };
  return (
    <Field label="Birth year">
      <input inputMode="numeric" maxLength={4} value={text} placeholder="e.g. 1990" onInput={(e) => save((e.target as HTMLInputElement).value)} />
    </Field>
  );
}

/** On an IRA's page: the limits, this IRA's contributions, and adding or confirming one. */
export function IraSection(props: { account: Account }) {
  const nav = useNav();
  const txns = useTransactions();
  const spots = useIraSpots();
  const birthYear = useBirthYear();
  const today = todayISO();
  const mine = txns.filter((t) => t.accountId === props.account.id && t.contributionYear != null).slice(0, 10);
  return (
    <>
      <Section
        title="Contributions"
        footer={`The limit is for all your IRAs together. ${birthYear ? '' : 'At 50 or older you can put in more; add your birth year below. '}Roth IRAs also have an income limit (see irs.gov).`}
      >
        <IraRoomMeters txns={txns} today={today} />
        {mine.map((t) => (
          <Row
            title={`${formatDay(t.date)} · for ${t.contributionYear}`}
            subtitle={t.contributionFrom ? 'From your bank file' : 'Added by hand'}
            detail={`+${whole(t.amount)}`}
            onClick={() => nav.present((close) => <TransactionEditor txn={t} onClose={close} />)}
          />
        ))}
        {spots.length > 0 && (
          <button type="button" class="row link-row" onClick={() => nav.present((close) => <SpottedContributionsSheet onClose={close} />)}>
            Review {spots.length} possible contribution{spots.length === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" class="row link-row" onClick={() => nav.present((close) => <ContributionSheet accountId={props.account.id} onClose={close} />)}>
          Add Contribution
        </button>
      </Section>
      {!birthYear && (
        <Section>
          <BirthYearField />
        </Section>
      )}
    </>
  );
}

/** Add a contribution by hand (when it isn't in a bank file you import). */
export function ContributionSheet(props: { accountId?: string; year?: number; onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const birthYear = useBirthYear();
  const iras = useAccounts().filter((a) => isIra(a) && !a.archived);
  const [accountId, setAccountId] = useState(props.accountId ?? iras[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const years = taxYearsFor(date || todayISO());
  const [chosen, setChosen] = useState(props.year ?? years[years.length - 1]);
  const year = years.includes(chosen) ? chosen : years[years.length - 1];
  const cents = parseUserAmount(amount);
  // Money already put in: a future date would count on top of a value that may already include it.
  const valid = !!accountId && cents != null && cents > 0 && !!date && date <= todayISO();
  const room = iraRoom(year, txns, birthYear);
  // The value you last entered already includes what went in by that day; later contributions add to it.
  const last = useBook().values.get(accountId)?.at(-1);

  const save = async () => {
    if (!valid) return;
    await db.transactions.add({
      id: newId(),
      accountId,
      date,
      amount: cents!,
      description: 'IRA contribution',
      payee: 'Contribution',
      categoryId: INVESTMENTS,
      categorySource: 'user',
      notes: '',
      source: 'manual',
      createdAt: Date.now(),
      contributionYear: year,
    });
    nav.toast(`Added ${whole(cents!)} for ${year}`);
    props.onClose();
  };

  if (!iras.length)
    return (
      <Sheet title="Add Contribution" onClose={props.onClose}>
        <Empty icon="sun" title="No IRA yet">
          <p>Add your Roth or Traditional IRA in Net Worth first.</p>
        </Empty>
      </Sheet>
    );

  return (
    <Sheet title="Add Contribution" onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section
        footer={
          <>
            {year}: {whole(room.contributed)} of {whole(room.limit)} in so far, across your IRAs. Deadline {formatDate(room.deadline)}.
            {last && date && (
              <>
                <br />
                {date <= last.date ? 'Already counted in' : 'Adds to'} the {whole(last.value)} value from {formatDate(last.date)}.
              </>
            )}
          </>
        }
      >
        {iras.length > 1 && (
          <Field label="IRA">
            <select value={accountId} onChange={(e) => setAccountId((e.target as HTMLSelectElement).value)}>
              {iras.map((a) => (
                <option value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Amount">
          <input inputMode="decimal" value={amount} placeholder="0.00" onInput={(e) => setAmount((e.target as HTMLInputElement).value)} autoFocus />
        </Field>
        <Field label="Date" hint={date > todayISO() ? 'Add a contribution once you’ve made it' : undefined}>
          <input type="date" value={date} max={todayISO()} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        </Field>
        {years.length > 1 && (
          <Field label="Counts for">
            <Segmented value={String(year)} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(v) => setChosen(Number(v))} />
          </Field>
        )}
      </Section>
    </Sheet>
  );
}

/** The IRA a bank line most likely went to: one at the bank it names, else the first. */
const likelyIra = (t: Transaction, iras: Account[]) =>
  iras.find((a) => a.institution.trim().length >= 3 && `${t.payee} ${t.description}`.toLowerCase().includes(a.institution.trim().toLowerCase())) ?? iras[0];

/** Bank lines that look like money sent to an IRA: yes (and which year), or no. */
export function SpottedContributionsSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const spots = useIraSpots();
  const txns = useTransactions();
  const accounts = useAccounts();
  const categories = byId(useCategories());
  const birthYear = useBirthYear();
  const reviewed = useMeta<string[]>(IRA_REVIEWED) ?? [];
  const iras = accounts.filter((a) => isIra(a) && !a.archived);
  const names = byId(accounts);
  const [picks, setPicks] = useState<Record<string, { accountId?: string; year?: number }>>({});

  // Last year's contribution while there's still room for it, otherwise this year's.
  const defaultYear = (t: Transaction) => {
    const years = taxYearsFor(t.date);
    return years.length > 1 && iraRoom(years[0], txns, birthYear).left > 0 ? years[0] : years[years.length - 1];
  };

  const yes = async (s: SpottedContribution) => {
    const t = s.txn;
    const pick = picks[t.id] ?? {};
    await db.transaction('rw', db.transactions, async () => {
      // One you typed already counts; otherwise it's made from the bank line (and undoing that import removes both).
      if (!s.match)
        await db.transactions.add({
          id: newId(),
          accountId: pick.accountId ?? likelyIra(t, iras).id,
          date: t.date,
          amount: -t.amount,
          description: `From ${names.get(t.accountId)?.name ?? 'your bank'}`,
          payee: 'Contribution',
          categoryId: INVESTMENTS,
          categorySource: 'user',
          notes: '',
          source: 'manual',
          createdAt: Date.now(),
          contributionYear: pick.year ?? defaultYear(t),
          contributionFrom: t.id,
        });
      // Money moved into your IRA isn't spending.
      if (categories.get(t.categoryId)?.group !== 'transfer') await db.transactions.update(t.id, { categoryId: INVESTMENTS, categorySource: 'user' });
    });
    if (s.match) await setMeta(IRA_REVIEWED, [...reviewed, t.id]);
    nav.toast('Counted as an IRA contribution');
  };
  const no = (s: SpottedContribution) => void setMeta(IRA_REVIEWED, [...reviewed, s.txn.id]);

  return (
    <Sheet title="IRA Contributions?" onClose={props.onClose}>
      {spots.length === 0 ? (
        <Empty icon="check" title="All caught up">
          <p>New transfers to a brokerage show up here after you import your bank’s file.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            These left your bank for a brokerage. Count the ones that went into an IRA, and they add to its value and to this year’s limit.
          </p>
          {spots.map((s) => {
            const t = s.txn;
            const years = taxYearsFor(t.date);
            const pick = picks[t.id] ?? {};
            const set = (p: { accountId?: string; year?: number }) => setPicks({ ...picks, [t.id]: { ...pick, ...p } });
            return (
              <Section>
                <Row
                  title={t.payee || t.description}
                  subtitle={`${formatDay(t.date)} · from ${names.get(t.accountId)?.name ?? 'your bank'}`}
                  detail={whole(-t.amount)}
                  chevron={false}
                />
                {s.match ? (
                  <div class="row muted">
                    Matches the {whole(s.match.amount)} you added for {s.match.contributionYear}.
                  </div>
                ) : (
                  <>
                    {iras.length > 1 && (
                      <Field label="Into">
                        <select value={pick.accountId ?? likelyIra(t, iras).id} onChange={(e) => set({ accountId: (e.target as HTMLSelectElement).value })}>
                          {iras.map((a) => (
                            <option value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {years.length > 1 && (
                      <Field label="Counts for">
                        <Segmented
                          value={String(pick.year ?? defaultYear(t))}
                          options={years.map((y) => ({ value: String(y), label: String(y) }))}
                          onChange={(v) => set({ year: Number(v) })}
                        />
                      </Field>
                    )}
                  </>
                )}
                <div class="row spot-actions">
                  <button type="button" class="pill primary" onClick={() => void yes(s)}>
                    IRA Contribution
                  </button>
                  <button type="button" class="pill" onClick={() => no(s)}>
                    Not One
                  </button>
                </div>
              </Section>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
