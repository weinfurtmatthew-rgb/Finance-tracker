import { useState } from 'preact/hooks';
import type { Category, Transaction } from '../types';
import { explainDescription, explainMessages, parseExplain } from '../ai/explain';
import { chat, useAi } from '../ai/client';
import { suggestFor } from '../ai/suggest';
import { db } from '../db';

/** "What is this charge?" Decodes bank jargon exactly; the on-device models add a best guess. */
export function ExplainPanel(props: { txn: Transaction; categories: Category[]; onUseName: (n: string) => void; onUseCategory: (id: string) => void }) {
  const ai = useAi();
  const [open, setOpen] = useState(false);
  const [guess, setGuess] = useState<{ name: string; business: string } | null | undefined>();
  const [aiCategory, setAiCategory] = useState<string | undefined>();
  const t = props.txn;
  const base = explainDescription(t.description, t.amount);
  const categoryId = aiCategory ?? base.categoryId;
  const cat = props.categories.find((c) => c.id === categoryId);

  const run = async () => {
    setOpen(true);
    if (ai.embed) {
      const all = await db.transactions.toArray();
      suggestFor(t, all, props.categories)
        .then((s) => s && s.similarity > 0.35 && setAiCategory(s.categoryId))
        .catch(() => {});
    }
    if (ai.llm) {
      setGuess(undefined);
      try {
        setGuess(parseExplain(await chat(explainMessages(t.description), 60)));
      } catch {
        setGuess(null);
      }
    } else setGuess(null);
  };

  if (!open) {
    return (
      <button type="button" class="row link-row" onClick={run}>
        ✨ What is this?
      </button>
    );
  }
  const name = guess?.name || base.suggestedName;
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
      {guess === undefined && ai.llm && <p class="muted">Asking the on-device AI…</p>}
      {guess && (
        <p>
          <span class="badge">AI guess</span> Probably <b>{guess.name}</b>
          {guess.business && guess.business !== 'unknown' ? `, a ${guess.business}` : ''}.
        </p>
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
