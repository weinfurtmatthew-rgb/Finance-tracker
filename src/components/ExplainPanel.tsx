import { useState } from 'preact/hooks';
import { Glyph } from './icons';
import type { Category, Transaction } from '../types';
import { explainDescription } from '../ai/explain';
import { useAi } from '../ai/client';
import { suggestFor } from '../ai/suggest';
import { db } from '../db';

/** "What is this charge?" Decodes bank jargon exactly; the on-device model suggests a category. */
export function ExplainPanel(props: { txn: Transaction; categories: Category[]; onUseName: (n: string) => void; onUseCategory: (id: string) => void }) {
  const ai = useAi();
  const [open, setOpen] = useState(false);
  const [aiCategory, setAiCategory] = useState<string | undefined>();
  const t = props.txn;
  const base = explainDescription(t.description, t.amount);
  const categoryId = aiCategory ?? base.categoryId;
  const cat = props.categories.find((c) => c.id === categoryId);

  const run = async () => {
    setOpen(true);
    if (!ai.embed) return;
    const all = await db.transactions.toArray();
    suggestFor(t, all, props.categories)
      .then((s) => s && (s.confident || s.similarity > 0.45) && setAiCategory(s.categoryId))
      .catch(() => {});
  };

  if (!open) {
    return (
      <button type="button" class="row link-row" onClick={run}>
        <Glyph name="spark" /> What is this?
      </button>
    );
  }
  const name = base.suggestedName;
  return (
    <div class="explain">
      {base.notes.length > 0 ? (
        <ul>
          {base.notes.map((n) => (
            <li>{n}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">No bank codes found in this description.</p>
      )}
      <div class="explain-actions">
        {name && name !== t.payee && (
          <button type="button" class="pill" onClick={() => props.onUseName(name)}>
            Rename to “{name}”
          </button>
        )}
        {cat && cat.id !== t.categoryId && (
          <button type="button" class="pill" onClick={() => props.onUseCategory(cat.id)}>
            {cat.emoji} {cat.name}
          </button>
        )}
      </div>
    </div>
  );
}
