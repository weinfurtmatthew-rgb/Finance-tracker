import { useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '../db';
import type { Account } from '../types';
import { formatMoney, parseAmount } from '../lib/money';
import { formatDay, formatShortDate, todayISO } from '../lib/dates';
import { isLiability } from '../lib/balances';
import { matchBank, reconcile, type Reconciliation } from '../lib/reconcile';
import { TRANSFER } from '../lib/categories';
import { Field, Section, Sheet } from './ui';

/**
 * "What does your bank show?" Compares the app's balance with the bank's and, when they differ, lists
 * the likely reasons, each with a fix.
 */
export function BalanceCheck(props: { account: Account; intro?: string; onDone?: () => void }) {
  const account = useLiveQuery(() => db.accounts.get(props.account.id), [props.account.id]) ?? props.account;
  const txns = useLiveQuery(() => db.transactions.where('accountId').equals(props.account.id).toArray(), [props.account.id]);
  const [text, setText] = useState('');
  const [result, setResult] = useState<Reconciliation>();
  const liability = isLiability(account);
  const today = todayISO();

  /** The bank's number as typed: owed is positive for cards and loans; a minus means overdrawn. */
  const bankBalance = () => {
    const entered = parseAmount(text);
    return entered == null ? null : liability ? Math.abs(entered) : entered;
  };

  const check = async () => {
    const bank = bankBalance();
    if (bank == null) return;
    // Fresh from the database, so re-checking after a fix sees it.
    const [acct, list] = await Promise.all([db.accounts.get(account.id), db.transactions.where('accountId').equals(account.id).toArray()]);
    const r = reconcile({ account: acct!, txns: list, bankBalance: bank, today });
    setResult(r);
    if (r.matches) await db.accounts.update(account.id, { checkedOn: today });
  };

  const removeDuplicates = async () => {
    await db.transactions.bulkDelete(result!.duplicates.map((p) => p.extra.id));
    await check();
  };

  const match = async () => {
    const fix = matchBank(account, result!);
    if (fix.openingBalance != null) await db.accounts.update(account.id, { openingBalance: fix.openingBalance, checkedOn: today });
    else {
      await db.transactions.add({
        id: newId(),
        accountId: account.id,
        date: today,
        amount: fix.adjustment!,
        description: 'Balance adjustment',
        payee: 'Balance adjustment',
        categoryId: TRANSFER,
        categorySource: 'user',
        notes: `Added by the balance check so the app matches your bank (${formatMoney(result!.bankBalance)}).`,
        source: 'manual',
        createdAt: Date.now(),
      });
      await db.accounts.update(account.id, { checkedOn: today });
    }
    setResult(undefined);
    setText('');
    props.onDone?.();
  };

  return (
    <>
      <Section
        title="Check your balance"
        footer={
          props.intro ??
          `Open your bank's app or site and type the ${liability ? 'current balance owed' : 'current balance'} shown there. ${
            account.checkedOn ? `Last matched ${formatShortDate(account.checkedOn)}.` : ''
          }`
        }
      >
        <Field label={liability ? 'Bank says I owe' : 'Bank shows'}>
          <input inputMode="decimal" placeholder="0.00" value={text} aria-label="Balance shown by your bank" onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        </Field>
        <button type="button" class="row link-row" disabled={bankBalance() == null || !txns} onClick={check}>
          Check
        </button>
      </Section>
      {result && <Result r={result} account={account} onRemoveDuplicates={removeDuplicates} onMatch={match} />}
    </>
  );
}

function Result(props: { r: Reconciliation; account: Account; onRemoveDuplicates: () => void; onMatch: () => void }) {
  const { r } = props;
  if (r.matches) {
    return (
      <div class="callout good" role="status">
        <strong>✓ Matches your bank</strong>
        <p>{formatMoney(r.appBalance)} in both. Nice.</p>
      </div>
    );
  }
  const diff = formatMoney(Math.abs(r.difference));
  const more = r.difference > 0;
  const liability = isLiability(props.account);
  return (
    <div class="callout warn balance-result" role="status">
      <strong>Off by {diff}</strong>
      <p>
        The app shows {formatMoney(r.appBalance)}; your bank shows {formatMoney(r.bankBalance)}.{' '}
        {liability ? (more ? 'The app thinks you owe less.' : 'The app thinks you owe more.') : more ? 'The app thinks you have more.' : 'The app thinks you have less.'}
      </p>
      <ul class="causes">
        {r.neverChecked && (
          <li>
            <b>Starting balance</b>
            <span class="cause-line">This account's balance was never checked, so its starting balance is probably just missing.</span>
          </li>
        )}
        {r.duplicates.length > 0 && (
          <li>
            <b>
              {r.duplicates.length} possible duplicate{r.duplicates.length === 1 ? '' : 's'}
              {r.duplicatesExplain ? ' (removing them makes it match exactly)' : ''}
            </b>
            {r.duplicates.slice(0, 5).map((p) => (
              <span class="cause-line">
                {p.extra.payee} · {formatMoney(p.extra.amount)} · {formatDay(p.extra.date)} and {formatDay(p.keep.date)}
              </span>
            ))}
            <button type="button" class="pill" onClick={props.onRemoveDuplicates}>
              Remove {r.duplicates.length === 1 ? 'the duplicate' : 'duplicates'}
            </button>
          </li>
        )}
        {r.gap && (
          <li>
            <b>
              No transactions from {formatDay(r.gap.from)} to {formatDay(r.gap.to)}
            </b>
            <span class="cause-line">A file for those dates may not have been imported. Download that range from your bank and import it.</span>
          </li>
        )}
        {r.pendingLikely && (
          <li>
            <b>Pending charges</b>
            <span class="cause-line">Your bank's number includes recent charges that may not be in the file yet. They'll arrive with your next import.</span>
          </li>
        )}
      </ul>
      <button type="button" class="pill primary" onClick={props.onMatch}>
        Match my bank
      </button>
      <p class="small">
        {r.neverChecked
          ? 'Sets the starting balance so the app shows what your bank shows.'
          : `Adds a ${diff} “Balance adjustment” today (not counted as spending or income).`}
      </p>
    </div>
  );
}

/** Balance check on its own screen (from an account). */
export function BalanceCheckSheet(props: { account: Account; onClose: () => void }) {
  return (
    <Sheet title="Check Balance" onClose={props.onClose}>
      <BalanceCheck account={props.account} />
    </Sheet>
  );
}
