import { useMemo, useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useAccounts, useRules, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account } from '../types';
import type { DraftTransaction } from '../lib/draft';
import { payeeHistory } from '../lib/categorize';
import { accountFor, accountTypeFor, findEarlierImport, planRepair, rocketGroups } from '../lib/rocketmoney';
import { Field, Section } from './ui';

const NEW = '__new__';

/**
 * Shown when a Rocket Money file comes in that was imported before as a plain CSV (all accounts in one,
 * signs possibly swapped): puts those rows right, then the normal import finds nothing left to add twice.
 */
export function RocketRepair(props: { drafts: DraftTransaction[] }) {
  const nav = useNav();
  const accounts = useAccounts();
  const txns = useTransactions();
  const rules = useRules();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => rocketGroups(props.drafts), [props.drafts]);
  const earlier = useMemo(() => findEarlierImport(props.drafts, accounts, txns), [props.drafts, accounts, txns]);
  const open = accounts.filter((a) => !a.archived);

  // Where each Rocket Money account's rows belong: an account with its number or name, else (for the
  // biggest one) the account most of its rows are in now, else a new account.
  const defaults = useMemo(() => {
    const m: Record<string, string> = {};
    groups.forEach((g, i) => {
      const found = accountFor(g.account, open)?.id;
      if (found) return void (m[g.account.key] = found);
      const rows = earlier.filter((e) => props.drafts[e.row].sourceAccount?.key === g.account.key);
      const counts = new Map<string, number>();
      for (const e of rows) counts.set(e.txn.accountId, (counts.get(e.txn.accountId) ?? 0) + 1);
      const where = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      m[g.account.key] = i === 0 && where ? where : NEW;
    });
    return m;
  }, [groups, earlier, accounts]);
  const target = (key: string) => choice[key] ?? defaults[key];

  const preview = useMemo(() => {
    if (!earlier.length) return null;
    const map = new Map(groups.map((g) => [g.account.key, target(g.account.key) === NEW ? `new:${g.account.key}` : target(g.account.key)]));
    return planRepair({ drafts: props.drafts, earlier, target: map, accounts, txns, rules });
  }, [earlier, groups, choice, defaults, txns, rules]);
  if (!preview || preview.fixed === 0) return null;

  const involved = groups.filter((g) => earlier.some((e) => props.drafts[e.row].sourceAccount?.key === g.account.key));
  const flipped = earlier.some((e) => e.flipped);
  const wrongPlace = preview.moved > 0;

  const fix = async () => {
    setBusy(true);
    try {
      const result = await db.transaction('rw', db.accounts, db.transactions, async () => {
        const known = await db.accounts.toArray();
        const map = new Map<string, string>();
        for (const g of involved) {
          let id = target(g.account.key);
          if (id === NEW) {
            const a: Account = {
              id: newId(),
              name: g.account.name,
              type: accountTypeFor(g.account),
              institution: g.account.institution ?? '',
              last4: g.account.last4,
              openingBalance: 0,
              archived: false,
              createdAt: Date.now(),
            };
            await db.accounts.add(a);
            known.push(a);
            id = a.id;
          } else if (g.account.last4 && !known.find((a) => a.id === id)?.last4) {
            await db.accounts.update(id, { last4: g.account.last4 });
          }
          map.set(g.account.key, id);
        }
        const all = await db.transactions.toArray();
        const plan = planRepair({ drafts: props.drafts, earlier: findEarlierImport(props.drafts, known, all), target: map, accounts: known, txns: all, rules, history: payeeHistory(all) });
        for (const u of plan.update) await db.transactions.update(u.id, u.changes);
        for (const m of plan.merge) await db.transactions.update(m.id, m.changes);
        await db.transactions.bulkDelete(plan.remove);
        for (const o of plan.openings) await db.accounts.update(o.accountId, { openingBalance: o.openingBalance });
        return plan;
      });
      nav.toast(`Fixed ${result.fixed} transactions${result.merged ? ` · ${result.merged} merged with your bank's` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Fix your earlier Rocket Money import"
      footer={`Rocket Money puts every account in one file and writes spending as positive numbers. The earlier import treated it as one plain file${flipped ? ', so spending and income came in swapped' : ''}${wrongPlace ? ' and other accounts’ transactions landed in one account' : ''}. Fixing corrects the signs, moves each row to its account, and merges the ones your bank's own files already brought in. Your categories and notes are kept.`}
    >
      <div class="row">
        <span class="row-main">
          <span class="row-title">
            {preview.fixed} transaction{preview.fixed === 1 ? '' : 's'} to fix
          </span>
          <span class="row-subtitle">
            {[preview.moved && `${preview.moved} to move`, preview.merged && `${preview.merged} already in your bank's files`].filter(Boolean).join(' · ') || 'signs and names'}
          </span>
        </span>
      </div>
      {involved.map((g) => (
        <Field label={g.account.label}>
          <select value={target(g.account.key)} aria-label={`Account for ${g.account.label}`} onChange={(e) => setChoice({ ...choice, [g.account.key]: (e.target as HTMLSelectElement).value })}>
            {open.map((a) => (
              <option value={a.id}>{a.name}</option>
            ))}
            <option value={NEW}>＋ New account “{g.account.name}”</option>
          </select>
        </Field>
      ))}
      <button type="button" class="row link-row" disabled={busy} onClick={() => void fix()}>
        {busy ? 'Fixing…' : 'Fix Earlier Import'}
      </button>
    </Section>
  );
}
