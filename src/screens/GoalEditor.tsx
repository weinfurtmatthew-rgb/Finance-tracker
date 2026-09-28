import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useAccounts } from '../hooks';
import { useNav } from '../nav';
import type { Goal } from '../types';
import { isLiability } from '../lib/balances';
import { centsToInput, parseUserAmount } from '../lib/money';
import { ActionSheet, Field, Section, Sheet, Toggle } from '../components/ui';

const EMOJI = ['🛟', '✈️', '🏠', '🚗', '🎓', '💍', '🎁', '💻', '🏖️', '💰'];

export function GoalEditor(props: { goal?: Goal; onClose: () => void }) {
  const nav = useNav();
  const accounts = useAccounts().filter((a) => !a.archived && !isLiability(a) && a.type !== 'vehicle');
  const g = props.goal;
  const [name, setName] = useState(g?.name ?? '');
  const [emoji, setEmoji] = useState(g?.emoji ?? EMOJI[0]);
  const [target, setTarget] = useState(g ? centsToInput(g.target) : '');
  const [hasDate, setHasDate] = useState(!!g?.targetDate);
  const [date, setDate] = useState(g?.targetDate ?? '');
  const [accountId, setAccountId] = useState(g?.accountId ?? accounts.find((a) => a.type === 'savings')?.id ?? accounts[0]?.id ?? '');
  const [confirm, setConfirm] = useState(false);
  const cents = parseUserAmount(target);
  const valid = !!name.trim() && !!cents && !!accountId && (!hasDate || !!date);

  const save = async () => {
    await db.goals.put({
      id: g?.id ?? newId(),
      name: name.trim(),
      emoji,
      target: cents!,
      targetDate: hasDate ? date : undefined,
      accountId,
      createdAt: g?.createdAt ?? Date.now(),
    });
    nav.toast(g ? 'Goal saved' : 'Goal added');
    props.onClose();
  };

  return (
    <Sheet title={g ? 'Edit Goal' : 'New Goal'} onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <div class="swatches" role="radiogroup" aria-label="Icon">
        {EMOJI.map((e) => (
          <button type="button" role="radio" aria-checked={e === emoji} class={`emoji-pick ${e === emoji ? 'on' : ''}`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <Section>
        <Field label="Name">
          <input value={name} placeholder="e.g. Emergency fund" onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus={!g} />
        </Field>
        <Field label="Target">
          <input inputMode="decimal" placeholder="0.00" value={target} onInput={(e) => setTarget((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      <Section
        title="Saved in"
        footer="Progress follows this account's balance, so it updates as you import. If several goals share one account, each counts the full balance."
      >
        {accounts.length ? (
          <Field label="Account">
            <select value={accountId} onChange={(e) => setAccountId((e.target as HTMLSelectElement).value)}>
              {accounts.map((a) => (
                <option value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
        ) : (
          <div class="row muted">Add a savings or checking account first.</div>
        )}
      </Section>
      <Section footer="With a date, the app works out how much to save per month and per paycheck.">
        <Toggle checked={hasDate} onChange={setHasDate} label="Target date" />
        {hasDate && (
          <Field label="By">
            <input type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
          </Field>
        )}
      </Section>
      {g && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setConfirm(true)}>
            Delete Goal
          </button>
        </Section>
      )}
      {confirm && (
        <ActionSheet
          message={`Delete “${g!.name}”? The linked account isn't affected.`}
          actions={[
            {
              label: 'Delete Goal',
              destructive: true,
              onClick: async () => {
                await db.goals.delete(g!.id);
                props.onClose();
              },
            },
          ]}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Sheet>
  );
}
