import { useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { byId, useCategories } from '../hooks';
import { useNav } from '../nav';
import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { payeeKey } from '../lib/categorize';
import { CategoryIcon, CategorySelect, Empty, Section, Sheet } from '../components/ui';

/**
 * Categories the on-device AI filled in by itself at import. Confirming them (or changing any) turns
 * them into your own choices, which is what the AI learns from; until then they don't teach it.
 */
export function ReviewAiPicks(props: { onClose: () => void }) {
  const nav = useNav();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const picks = useLiveQuery(() => db.transactions.filter((t) => t.categorySource === 'ai').toArray(), []);
  const [choice, setChoice] = useState<Record<string, string>>({});

  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>();
    for (const t of picks ?? []) {
      const key = `${t.amount > 0 ? 'in' : 'out'}:${payeeKey(t.payee)}`;
      m.set(key, [...(m.get(key) ?? []), t]);
    }
    return [...m].sort((a, b) => b[1].length - a[1].length);
  }, [picks]);

  const confirm = async () => {
    const changes = groups.flatMap(([key, list]) =>
      list.map((t) => ({ key: t.id, changes: { categoryId: choice[key] ?? t.categoryId, categorySource: 'user' as const } })),
    );
    await db.transactions.bulkUpdate(changes);
    const fixed = groups.filter(([key, list]) => choice[key] && choice[key] !== list[0].categoryId).length;
    nav.toast(fixed ? `Saved · ${fixed} corrected` : `Confirmed ${changes.length}`);
    props.onClose();
  };

  if (!picks) return null;
  return (
    <Sheet title="Review AI Picks" onClose={props.onClose} onSave={groups.length ? confirm : undefined} saveLabel="Confirm All">
      {groups.length === 0 ? (
        <Empty icon="check" title="All reviewed">
          <p>Nothing the AI categorized is waiting for review.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            The on-device AI filed these by itself. Fix any that look wrong, then Confirm All. Your corrections teach it for next time.
          </p>
          <Section>
            {groups.map(([key, list]) => {
              const t = list[0];
              const value = choice[key] ?? t.categoryId;
              return (
                <div class="suggest-row">
                  <div class="suggest-top">
                    <CategoryIcon category={cats.get(value)} size="sm" />
                    <span class="row-main">
                      <span class="row-title">{t.payee}</span>
                      <span class="row-subtitle">
                        {list.length} transaction{list.length === 1 ? '' : 's'} · {formatMoney(list.reduce((s, x) => s + x.amount, 0))}
                      </span>
                    </span>
                  </div>
                  <CategorySelect
                    class="chip"
                    aria-label={`Category for ${t.payee}`}
                    categories={categories}
                    value={value}
                    onChange={(id) => setChoice({ ...choice, [key]: id })}
                  />
                </div>
              );
            })}
          </Section>
        </>
      )}
    </Sheet>
  );
}
