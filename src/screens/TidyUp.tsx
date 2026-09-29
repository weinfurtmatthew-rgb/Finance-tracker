import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setMeta } from '../db';
import { byId, useCategories } from '../hooks';
import { useNav } from '../nav';
import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { payeeKey } from '../lib/categorize';
import { oldGuesses } from '../lib/cleanup';
import { useAi } from '../ai/client';
import { suggestForTxns } from '../ai/suggest';
import type { Suggestion } from '../ai/similar';
import { CategoryIcon, CategorySelect, Empty, Section, Sheet } from '../components/ui';

/** Transactions whose category is only an old guess, for the one-time tidy-up. */
export function useOldGuesses(): Transaction[] | undefined {
  return useLiveQuery(async () => {
    const [txns, rules, accounts] = await Promise.all([db.transactions.toArray(), db.rules.toArray(), db.accounts.toArray()]);
    return oldGuesses(txns, rules, accounts);
  }, []);
}

const groupKey = (t: Transaction) => `${t.amount > 0 ? 'in' : 'out'}:${payeeKey(t.payee)}`;

/**
 * One-time review of old guessed categories (Other, unknown money-in as Income, Uncategorized). With
 * on-device AI on, confident picks are filled in; nothing changes until you tap Apply, and everything
 * you apply (changed or kept) counts as your own choice from then on.
 */
export function TidyUp(props: { onClose: () => void }) {
  const nav = useNav();
  const ai = useAi();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const targets = useOldGuesses();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [hints, setHints] = useState<Record<string, Suggestion | null>>();
  const [frozen, setFrozen] = useState<[string, Transaction[]][]>();

  // Freeze the list when it first loads, so applying doesn't reshuffle it under your finger.
  useEffect(() => {
    if (!targets || frozen) return;
    const m = new Map<string, Transaction[]>();
    for (const t of targets) m.set(groupKey(t), [...(m.get(groupKey(t)) ?? []), t]);
    setFrozen([...m].sort((a, b) => b[1].length - a[1].length));
  }, [targets]);

  useEffect(() => {
    if (!ai.embed || !targets?.length || hints || !categories.length) return;
    db.transactions
      .toArray()
      .then((all) => suggestForTxns(targets, all, categories))
      .then((groups) => {
        const h: Record<string, Suggestion | null> = {};
        const pre: Record<string, string> = {};
        for (const g of groups) {
          const key = groupKey(g.txns[0]);
          h[key] = g.suggestion;
          if (g.suggestion?.confident) pre[key] = g.suggestion.categoryId;
        }
        setHints(h);
        setChoice((c) => ({ ...pre, ...c }));
      })
      .catch(() => setHints({}));
  }, [ai.embed, targets?.length, categories.length]);

  const groups = frozen ?? [];
  const changes = groups.filter(([key, list]) => choice[key] && choice[key] !== list[0].categoryId).length;

  const apply = async () => {
    await db.transactions.bulkUpdate(
      groups.flatMap(([key, list]) => list.map((t) => ({ key: t.id, changes: { categoryId: choice[key] ?? t.categoryId, categorySource: 'user' as const } }))),
    );
    await setMeta('tidyUpDone', Date.now());
    nav.toast(changes ? `Updated ${changes} payee${changes === 1 ? '' : 's'}` : 'All confirmed');
    props.onClose();
  };

  if (!frozen) return <Sheet title="Tidy Up Categories" onClose={props.onClose}>{null}</Sheet>;
  return (
    <Sheet title="Tidy Up Categories" onClose={props.onClose} onSave={groups.length ? apply : undefined} saveLabel={changes ? `Apply ${changes}` : 'Confirm'}>
      {groups.length === 0 ? (
        <Empty icon="✨" title="Nothing to tidy">
          <p>Every category is one you or a rule chose, or one the app is sure about.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            These older transactions were filed by a guess (the bank's “Other”, unknown money coming in as Income, or no category).
            {ai.embed
              ? ' The on-device AI filled in the ones it is sure about; tap a suggestion to use it.'
              : ' Turn on on-device AI in Settings for suggestions.'}{' '}
            Change any that are wrong, then tap {changes ? 'Apply' : 'Confirm'}. Whatever you confirm counts as your own choice from now on.
          </p>
          <Section>
            {groups.map(([key, list]) => {
              const t = list[0];
              const value = choice[key] ?? t.categoryId;
              const hint = hints?.[key];
              return (
                <div class="suggest-row">
                  <div class="suggest-top">
                    <CategoryIcon category={cats.get(value)} size="sm" />
                    <span class="row-main">
                      <span class="row-title">{t.payee || t.description}</span>
                      <span class="row-subtitle">
                        {list.length} transaction{list.length === 1 ? '' : 's'} · {formatMoney(list.reduce((s, x) => s + x.amount, 0))} · now {cats.get(t.categoryId)?.name ?? 'Uncategorized'}
                      </span>
                    </span>
                    {hint && <span class={`confidence ${hint.confident ? 'high' : ''}`}>{hint.confident ? 'Likely' : 'Guess'}</span>}
                  </div>
                  <CategorySelect class="chip" aria-label={`Category for ${t.payee}`} categories={categories} value={value} onChange={(id) => setChoice({ ...choice, [key]: id })} />
                  {hint && value !== hint.categoryId && cats.get(hint.categoryId) && (
                    <button type="button" class="link small" onClick={() => setChoice({ ...choice, [key]: hint.categoryId })}>
                      Maybe {cats.get(hint.categoryId)!.emoji} {cats.get(hint.categoryId)!.name}?
                    </button>
                  )}
                </div>
              );
            })}
          </Section>
        </>
      )}
    </Sheet>
  );
}
