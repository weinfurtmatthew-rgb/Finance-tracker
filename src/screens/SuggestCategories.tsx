import { useEffect, useMemo, useState } from 'preact/hooks';
import { db, newId } from '../db';
import { byId, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { formatMoney } from '../lib/money';
import { useAi } from '../ai/client';
import { suggestForUncategorized, type PayeeGroup } from '../ai/suggest';
import { CategorySelect, Empty, Section, Sheet, Toggle } from '../components/ui';

export function SuggestCategories(props: { onClose: () => void }) {
  const nav = useNav();
  const ai = useAi();
  const txns = useTransactions();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const [groups, setGroups] = useState<PayeeGroup[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ai.embed || groups || !txns.length) return;
    suggestForUncategorized(txns, categories)
      .then((g) => {
        setGroups(g);
        setChoice(Object.fromEntries(g.filter((x) => x.suggestion?.confident).map((x) => [x.key, x.suggestion!.categoryId])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ai.embed, txns.length]);

  const chosen = Object.entries(choice).filter(([, id]) => id && id !== 'uncategorized');
  const apply = async () => {
    let n = 0;
    await db.transaction('rw', db.transactions, db.rules, async () => {
      for (const [key, categoryId] of chosen) {
        const g = groups!.find((x) => x.key === key)!;
        await db.transactions.bulkUpdate(g.txns.map((t) => ({ key: t.id, changes: { categoryId, categorySource: 'user' as const } })));
        n += g.txns.length;
        if (remember) await db.rules.add({ id: newId(), match: g.payee, categoryId, createdAt: Date.now() });
      }
    });
    nav.toast(`Categorized ${n} transaction${n === 1 ? '' : 's'}`);
    props.onClose();
  };

  if (!ai.embed) {
    return (
      <Sheet title="Suggest Categories" onClose={props.onClose}>
        <Empty icon="spark" title="Turn on on-device AI">
          <p>Category suggestions use a small AI model that runs on this phone. Turn it on in Settings → On-device AI.</p>
          <button type="button" class="button" onClick={() => { props.onClose(); nav.openSettings(); }}>
            Go to Settings
          </button>
        </Empty>
      </Sheet>
    );
  }

  return (
    <Sheet title="Suggest Categories" onClose={props.onClose} onSave={groups?.length ? apply : undefined} saveLabel={`Apply ${chosen.length}`} saveDisabled={!chosen.length}>
      {error && <p class="error padded">{error}</p>}
      {!groups && !error && <p class="padded muted">Comparing with the payees you've already categorized…</p>}
      {groups && groups.length === 0 && <Empty icon="check" title="Nothing to categorize" />}
      {groups && groups.length > 0 && (
        <>
          <p class="section-footer intro">“Likely” picks are filled in; for guesses, tap the suggestion to use it. Suggestions come from payees you've already categorized.</p>
          <Section>
            {groups.map((g) => (
              <div class="suggest-row">
                <div class="suggest-top">
                  <span class="row-main">
                    <span class="row-title">{g.payee}</span>
                    <span class="row-subtitle">
                      {g.txns.length} transaction{g.txns.length === 1 ? '' : 's'} · {formatMoney(g.total)}
                      {g.suggestion?.like && ` · like “${g.suggestion.like}”`}
                    </span>
                  </span>
                  {g.suggestion && <span class={`confidence ${g.suggestion.confident ? 'high' : ''}`}>{g.suggestion.confident ? 'Likely' : 'Guess'}</span>}
                </div>
                <CategorySelect
                  class="chip"
                  aria-label={`Category for ${g.payee}`}
                  categories={categories}
                  value={choice[g.key] ?? 'uncategorized'}
                  onChange={(id) => setChoice({ ...choice, [g.key]: id })}
                />
                {g.suggestion && cats.get(g.suggestion.categoryId) && choice[g.key] !== g.suggestion.categoryId && (
                  <button type="button" class="link small" onClick={() => setChoice({ ...choice, [g.key]: g.suggestion!.categoryId })}>
                    Maybe {cats.get(g.suggestion.categoryId)!.emoji} {cats.get(g.suggestion.categoryId)!.name}?
                  </button>
                )}
              </div>
            ))}
          </Section>
          <Section footer="Creates a rule for each payee so future imports are categorized automatically.">
            <Toggle checked={remember} onChange={setRemember} label="Remember for future imports" />
          </Section>
        </>
      )}
    </Sheet>
  );
}
