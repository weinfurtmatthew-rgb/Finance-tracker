import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useAccounts, useBook } from '../hooks';
import { useNav } from '../nav';
import type { Account } from '../types';
import { CD_TERMS, cdMaturityValue, maturityDate, termLabel, termMonths } from '../lib/cd';
import { formatDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Field, Section, Sheet } from '../components/ui';

/**
 * A CD reached its maturity date: did it renew for another term, or did you move the money? Renewing
 * starts the next term at what it was worth that day; moving the money hides the CD from then on,
 * keeping it in your net worth history until that day.
 */
export function CdMaturitySheet(props: { account: Account; onClose: () => void }) {
  const a = useAccounts().find((x) => x.id === props.account.id) ?? props.account;
  const book = useBook();
  const nav = useNav();
  const anchors = book.values.get(a.id) ?? [];
  const matured = a.maturesOn!;
  const worth = cdMaturityValue(a, anchors) ?? 0;
  const lastTerm = a.openedOn ? termMonths(a.openedOn, matured) : null;
  const [renewing, setRenewing] = useState(false);
  const [term, setTerm] = useState(String(lastTerm && CD_TERMS.includes(lastTerm) ? lastTerm : 12));
  const [apy, setApy] = useState(a.apy != null ? String(Math.round(a.apy * 10000) / 100) : '');

  const renew = async () => {
    const n = parseFloat(apy.replace('%', ''));
    await db.transaction('rw', db.accounts, db.valuations, async () => {
      // The new term starts at what the CD was worth on the day it matured.
      const existing = anchors.find((v) => v.date === matured);
      if (existing) await db.valuations.update(existing.id, { value: worth });
      else await db.valuations.add({ id: newId(), accountId: a.id, date: matured, value: worth });
      await db.accounts.update(a.id, {
        openedOn: matured,
        maturesOn: maturityDate(matured, Number(term)),
        apy: Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 10000 : a.apy,
      });
    });
    nav.toast(`Renewed until ${formatDate(maturityDate(matured, Number(term)))}`);
    props.onClose();
  };

  const moved = async () => {
    await db.accounts.update(a.id, { archived: true, closedOn: matured });
    nav.toast('CD closed');
    props.onClose();
  };

  return (
    <Sheet title="CD Matured" onClose={props.onClose} onSave={renewing ? renew : undefined} saveLabel="Renew">
      <p class="section-footer intro">
        {a.name} matured on {formatDate(matured)}, worth about <b>{formatMoney(worth)}</b>. Most CDs renew for the same term unless you move the money during a
        short grace period. Your bank’s site shows which happened.
      </p>
      {renewing ? (
        <Section title="The new term" footer="Starts at what it was worth when it matured. Your bank shows the new rate.">
          <Field label="Term" hint={`Matures ${formatDate(maturityDate(matured, Number(term)))}`}>
            <select value={term} onChange={(e) => setTerm((e.target as HTMLSelectElement).value)}>
              {CD_TERMS.map((m) => (
                <option value={String(m)}>{termLabel(m)}</option>
              ))}
            </select>
          </Field>
          <Field label="New APY">
            <input inputMode="decimal" value={apy} placeholder="e.g. 4.00" onInput={(e) => setApy((e.target as HTMLInputElement).value)} />
            <span class="affix">%</span>
          </Field>
        </Section>
      ) : (
        <div class="button-stack">
          <button type="button" class="button primary" onClick={() => setRenewing(true)}>
            It Renewed
          </button>
          <button type="button" class="button" onClick={moved}>
            I Moved the Money
          </button>
          <p class="section-footer">Moving it closes the CD here. The money shows up in the account it went to when you import that bank’s file.</p>
        </div>
      )}
    </Sheet>
  );
}
