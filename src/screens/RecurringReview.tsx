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
import { Dotted, Empty, KindIcon, Sheet } from '../components/ui';

/** Charges billed under one company's name for different things, listed by price (Apple). */
const byPrice = (s: Suggestion) => s.matchAmount != null;
const isApple = (s: Suggestion) => /^apple\b/.test(s.match);

async function confirm(s: Suggestion, kind: RecurringKind, label = '') {
  const rec = suggestionToRecurring(s, kind, newId());
  // Named ("Apple Music"): the charges show that name instead of "Apple".
  if (label.trim()) Object.assign(rec, { name: label.trim(), showName: true });
  // Apple suggestions are named "Apple ($2.99)"; the link still applies.
  if (kind === 'subscription') rec.cancelUrl = cancelLinkFor(s.name, s.match);
  await db.recurring.add(rec);
}

function SuggestionCard(props: { s: Suggestion }) {
  const { s } = props;
  const [kind, setKind] = useState<RecurringKind>(s.kind);
  const [label, setLabel] = useState('');
  return (
    <div class="suggestion">
      <div class="suggestion-top">
        <KindIcon kind={kind} />
        <span class="row-main">
          <span class="row-title">{s.name}</span>
          <span class="row-subtitle wrap">
            <Dotted parts={[FREQUENCIES[s.frequency].label, `${s.count} charges`, `last ${formatShortDate(s.lastDate)}`]} />
          </span>
        </span>
        <span class={`row-detail ${s.amount > 0 ? 'pos-text' : ''}`}>{formatMoney(s.amount, { sign: s.amount > 0 })}</span>
      </div>
      {byPrice(s) && (
        <label class="suggestion-name">
          <span class="suggestion-name-label">What is it?</span>
          <input
            value={label}
            placeholder={isApple(s) ? 'e.g. iCloud+, Apple Music' : 'e.g. the plan’s name'}
            aria-label={`What ${s.name} is`}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          />
        </label>
      )}
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
        <button type="button" class="pill primary" onClick={() => confirm(s, kind, label)}>
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
    <Sheet title="Possible Bills & Subscriptions" onClose={props.onClose} onSave={suggestions.length ? addAll : undefined} saveLabel="Add All">
      {suggestions.length === 0 ? (
        <Empty icon="check" title="All reviewed">
          <p>New suggestions appear here after you import more transactions.</p>
        </Empty>
      ) : (
        <>
          <p class="section-footer intro">
            These charges repeat on a regular schedule. Check the type (it decides which totals they count toward), then add or dismiss each one.
          </p>
          {suggestions.some(isApple) && (
            <p class="section-footer intro">
              Apple bills every App Store subscription as “Apple”, so those are listed by price. Your iPhone shows which is which in Settings → your name →
              Subscriptions; name them here and their charges show that name.
            </p>
          )}
          {suggestions.map((s) => (
            <SuggestionCard key={s.key} s={s} />
          ))}
        </>
      )}
    </Sheet>
  );
}
