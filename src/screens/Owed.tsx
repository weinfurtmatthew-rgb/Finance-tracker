import { useStore } from '../store';
import { db } from '../db';
import { useNav } from '../nav';
import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { addDays, formatDay } from '../lib/dates';
import { OWED, UNCATEGORIZED } from '../lib/categories';
import { owedByPerson, owedItems, repaymentCandidates, type OwedItem } from '../lib/lines';
import { Empty, Row, Section, Sheet } from '../components/ui';
import { TransactionEditor } from './TransactionEditor';

/** Record that `items` were paid back, by a transaction in the app or outside it ('untracked'). */
export async function settle(items: OwedItem[], by: string | null) {
  await db.transaction('rw', db.transactions, async () => {
    for (const i of items) {
      const t = (await db.transactions.get(i.txn.id))!;
      if (i.splitId) {
        const splits = t.splits!.map((s) => (s.id === i.splitId ? { ...s, settledBy: by ?? undefined } : s));
        for (const s of splits) if (!s.settledBy) delete s.settledBy;
        await db.transactions.update(t.id, { splits });
      } else await db.transactions.update(t.id, { settledBy: by ?? undefined });
    }
    // The repayment is money coming back, not income.
    if (by && by !== 'untracked') await db.transactions.update(by, { categoryId: OWED, categorySource: 'user' });
  });
}

/** Undo a "paid back": the repayment goes back to needing a category. */
async function unsettle(items: OwedItem[]) {
  const linked = new Set(items.map((i) => i.settledBy).filter((x): x is string => !!x && x !== 'untracked'));
  await settle(items, null);
  for (const id of linked) await db.transactions.update(id, { categoryId: UNCATEGORIZED, categorySource: undefined });
}

/** Choose the transaction that paid you back (e.g. a Venmo or a reimbursement deposit). */
export function SettleSheet(props: { item?: OwedItem; items?: OwedItem[]; onClose: () => void }) {
  const nav = useNav();
  const items = props.items ?? (props.item ? [props.item] : []);
  const total = items.reduce((s, i) => s + i.amount, 0);
  const earliest = items.reduce((m, i) => (i.date < m ? i.date : m), items[0]?.date ?? '');
  const txns = useStore().raw.transactions;
  const settled = items.every((i) => i.settledBy);
  const candidates = txns ? repaymentCandidates(txns, total, addDays(earliest, -3)) : [];
  const who = [...new Set(items.map((i) => i.who))].join(', ');

  const done = async (by: string) => {
    await settle(items, by);
    nav.toast('Marked as paid back');
    props.onClose();
  };

  return (
    <Sheet title="Paid Back?" onClose={props.onClose}>
      <p class="section-footer intro">
        {who} owes you <b>{formatMoney(total)}</b>
        {items.length > 1 ? ` for ${items.length} things` : ` for ${items[0]?.txn.payee}`}.
        {settled ? ' This is marked as paid back.' : ' Pick the payment that paid you back so it isn’t counted as income.'}
      </p>
      {settled ? (
        <Section>
          <button
            type="button"
            class="row danger-row"
            onClick={async () => {
              await unsettle(items);
              nav.toast('Marked as not paid back');
              props.onClose();
            }}
          >
            Mark as Not Paid Back
          </button>
        </Section>
      ) : (
        <>
          <Section title="Money that came in" footer="Closest amounts first. The one you pick is filed under Owed to Me, so it doesn’t count as income.">
            {candidates.length ? (
              candidates.map((t: Transaction) => (
                <Row title={t.payee} subtitle={formatDay(t.date)} detail={<span class="money pos">+{formatMoney(t.amount)}</span>} onClick={() => done(t.id)} />
              ))
            ) : (
              <div class="row muted">No money came in since then.</div>
            )}
          </Section>
          <Section>
            <button type="button" class="row link-row" onClick={() => done('untracked')}>
              Paid in cash, or not in the app
            </button>
          </Section>
        </>
      )}
    </Sheet>
  );
}

/** Everything you paid for someone else and haven't been paid back for yet. */
export function OwedSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const txns = useStore().raw.transactions;
  if (!txns) return null;
  const items = owedItems(txns);
  const people = owedByPerson(items);
  const paid = items.filter((i) => i.settledBy).slice(0, 20);

  return (
    <Sheet title="Owed to You" onClose={props.onClose}>
      {!items.length ? (
        <Empty icon="users" title="Nobody owes you">
          <p>When you pay for someone else, open the transaction and turn on “Paid for someone else”, or split it and mark a part. It shows up here until you’re paid back.</p>
        </Empty>
      ) : (
        <>
          {people.length === 0 && <p class="section-footer intro">✓ Everyone has paid you back.</p>}
          {people.map((p) => (
            <Section
              title={
                <>
                  <span>
                    {p.who} · {formatMoney(p.total)}
                  </span>
                  <button type="button" class="link" onClick={() => nav.present((close) => <SettleSheet items={p.items} onClose={close} />)}>
                    Paid all back
                  </button>
                </>
              }
            >
              {p.items.map((i) => (
                <Row title={i.txn.payee} subtitle={formatDay(i.date)} detail={formatMoney(i.amount)} onClick={() => nav.present((close) => <SettleSheet item={i} onClose={close} />)} />
              ))}
            </Section>
          ))}
          {paid.length > 0 && (
            <Section title="Paid back">
              {paid.map((i) => (
                <Row
                  title={`${i.who} · ${i.txn.payee}`}
                  subtitle={`${formatDay(i.date)} · paid back ✓`}
                  detail={formatMoney(i.amount)}
                  onClick={() => nav.present((close) => <TransactionEditor txn={i.txn} onClose={close} />)}
                />
              ))}
            </Section>
          )}
        </>
      )}
    </Sheet>
  );
}
