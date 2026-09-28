import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import type { RecurringKind } from '../types';
import { formatShortDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { FREQUENCIES, KINDS, suggestionToRecurring, type Suggestion } from '../lib/recurring';
import { cancelLinkFor } from '../lib/cancelLinks';
import { dismissSuggestion } from '../lib/recurringActions';
import { Empty, Sheet } from '../components/ui';

async function confirm(s: Suggestion, kind: RecurringKind) {
  const rec = suggestionToRecurring(s, kind, newId());
  // Apple suggestions are named "Apple ($2.99)"; the link still applies.
  if (kind === 'subscription') rec.cancelUrl = cancelLinkFor(s.name, s.match);
  await db.recurring.add(rec);
}

function SuggestionCard(props: { s: Suggestion }) {
  const { s } = props;
  const [kind, setKind] = useState<RecurringKind>(s.kind);
  return (
    <div class="suggestion">
      <div class="suggestion-top">
        <span class="cat-icon md" aria-hidden="true">
          {KINDS[kind].emoji}
        </span>
        <span class="row-main">
          <span class="row-title">{s.name}</span>
          <span class="row-subtitle">
            {FREQUENCIES[s.frequency].label} · {s.count} charges · last {formatShortDate(s.lastDate)}
          </span>
        </span>
        <span class={`row-detail ${s.amount > 0 ? 'pos-text' : ''}`}>{formatMoney(s.amount, { sign: s.amount > 0 })}</span>
      </div>
      <div class="suggestion-actions">
        <select class="chip" value={kind} aria-label="Type" onChange={(e) => setKind((e.target as HTMLSelectElement).value as RecurringKind)}>
          {(Object.keys(KINDS) as RecurringKind[])
            .filter((k) => k !== 'trial')
            .map((k) => (
              <option value={k}>{KINDS[k].label}</option>
            ))}
        </select>
        <span class="spacer" />
        <button type="button" class="pill" onClick={() => dismissSuggestion(s.key)}>
          Skip
        </button>
        <button type="button" class="pill primary" onClick={() => confirm(s, kind)}>
          Add
        </button>
      </div>
    </div>
  );
}

export function RecurringReview(props: { onClose: () => void }) {
  const nav = useNav();
  const { suggestions, loaded } = useRecurringModel();
  if (!loaded) return null;
  const addAll = async () => {
    for (const s of suggestions) await confirm(s, s.kind);
    nav.toast(`Added ${suggestions.length}`);
    props.onClose();
  };
  return (
    <Sheet title="Possible Recurring" onClose={props.onClose} onSave={suggestions.length ? addAll : undefined} saveLabel="Add All">
      {suggestions.length === 0 ? (
        <Empty icon="✅" title="All reviewed">
          <p>New suggestions appear here after you import more transactions.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            These charges repeat on a regular schedule. Check the type (it decides which totals they count toward), then add or dismiss each one.
          </p>
          {suggestions.map((s) => (
            <SuggestionCard key={s.key} s={s} />
          ))}
        </>
      )}
    </Sheet>
  );
}
