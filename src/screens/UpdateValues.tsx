import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useBook } from '../hooks';
import { useNav } from '../nav';
import { formatShortDate, todayISO } from '../lib/dates';
import { parseAmount } from '../lib/money';
import { balanceOn, isValued } from '../lib/networth';
import type { BalanceBook } from '../lib/networth';
import { Field, Section, Sheet } from '../components/ui';

export function UpdateValues(props: { onClose: () => void }) {
  const book = useBook();
  if (!book.accounts.length) return null;
  return <Form book={book} onClose={props.onClose} />;
}

function Form(props: { book: BalanceBook; onClose: () => void }) {
  const nav = useNav();
  const accounts = props.book.accounts.filter((a) => isValued(a) && !a.archived);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.map((a) => [a.id, (balanceOn(props.book, a) / 100).toFixed(2)])),
  );
  const today = todayISO();

  const save = async () => {
    let n = 0;
    for (const a of accounts) {
      const cents = parseAmount(values[a.id]);
      if (cents == null) continue;
      const last = props.book.values.get(a.id)?.at(-1);
      // Re-entering the same value still counts: it confirms the value as of today.
      if (last?.date === today) await db.valuations.update(last.id, { value: cents });
      else await db.valuations.add({ id: newId(), accountId: a.id, date: today, value: cents });
      n++;
    }
    nav.toast(`Updated ${n} value${n === 1 ? '' : 's'}`);
    props.onClose();
  };

  return (
    <Sheet title="Update Values" onClose={props.onClose} onSave={save}>
      <p class="section-footer intro">
        Enter what each is worth today: the total shown on your brokerage's site, or a resale estimate for a vehicle (Kelley Blue Book, Edmunds or Carvana).
        Each update adds a point to your net worth history.
      </p>
      {accounts.length === 0 ? (
        <p class="padded muted">No investment or vehicle accounts yet. Add one from the Net Worth tab.</p>
      ) : (
        <Section>
          {accounts.map((a) => {
            const last = props.book.values.get(a.id)?.at(-1);
            return (
              <Field label={a.name} hint={last ? `Last updated ${formatShortDate(last.date)}` : 'Never updated'}>
                <input inputMode="decimal" value={values[a.id]} onInput={(e) => setValues({ ...values, [a.id]: (e.target as HTMLInputElement).value })} />
              </Field>
            );
          })}
        </Section>
      )}
    </Sheet>
  );
}
