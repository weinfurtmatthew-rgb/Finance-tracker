import { useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { byId, useCategories } from '../hooks';
import { useNav } from '../nav';
import type { Transaction } from '../types';
import { formatMoney } from '../lib/money';
import { addDays, formatDay, formatShortDate, todayISO } from '../lib/dates';
import { allTags, cleanTag, lines, tagKey } from '../lib/lines';
import { ActionSheet, CategoryIcon, Empty, Field, Row, Section, Sheet } from '../components/ui';
import { RankedBars } from '../components/charts';

const hasTag = (t: Transaction, tag: string) => !!t.tags?.some((x) => tagKey(x) === tagKey(tag));

/** Spending on a tag: expense lines only (card payments, transfers and money owed to you don't count). */
function tagSpending(txns: Transaction[], tag: string, groups: Map<string, string>) {
  const tagged = txns.filter((t) => hasTag(t, tag));
  const byCat = new Map<string, number>();
  let total = 0;
  for (const l of lines(tagged)) {
    if (groups.get(l.categoryId) !== 'expense') continue;
    total -= l.amount;
    byCat.set(l.categoryId, (byCat.get(l.categoryId) ?? 0) - l.amount);
  }
  return { tagged, total, byCat: [...byCat].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) };
}

/** Every tag with its total spending, newest first. */
export function TagsSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const txns = useLiveQuery(() => db.transactions.toArray(), []);
  const categories = useCategories();
  const groups = useMemo(() => new Map(categories.map((c) => [c.id, c.group as string])), [categories]);
  if (!txns) return null;
  const tags = allTags(txns);
  return (
    <Sheet title="Tags" onClose={props.onClose}>
      <Section footer="Tag a trip or event to see what it cost across every category. Add tags on any transaction, or tag a whole date range at once.">
        <button type="button" class="row link-row" onClick={() => nav.present((close) => <TagTripSheet onClose={close} />)}>
          Tag a Trip or Event…
        </button>
      </Section>
      {tags.length === 0 ? (
        <Empty icon="🏷️" title="No tags yet" />
      ) : (
        <Section title="Your tags">
          {tags.map((t) => (
            <Row
              title={`#${t.tag}`}
              subtitle={`${t.count} transaction${t.count === 1 ? '' : 's'} · ${formatShortDate(t.first)}${t.first !== t.last ? ` – ${formatShortDate(t.last)}` : ''}`}
              detail={formatMoney(tagSpending(txns, t.tag, groups).total, { whole: true })}
              onClick={() => nav.present((close) => <TagDetail tag={t.tag} onClose={close} />)}
            />
          ))}
        </Section>
      )}
    </Sheet>
  );
}

/** What a tag cost, by category, with rename and remove. */
export function TagDetail(props: { tag: string; onClose: () => void }) {
  const nav = useNav();
  const txns = useLiveQuery(() => db.transactions.toArray(), []);
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const groups = useMemo(() => new Map(categories.map((c) => [c.id, c.group as string])), [categories]);
  const [name, setName] = useState(props.tag);
  const [confirm, setConfirm] = useState(false);
  if (!txns) return null;
  const { tagged, total, byCat } = tagSpending(txns, props.tag, groups);

  const rename = async () => {
    const next = name.trim().replace(/^#/, '');
    if (!next || next === props.tag) return props.onClose();
    // Renaming onto an existing tag merges the two.
    await db.transactions
      .filter((t) => hasTag(t, props.tag))
      .modify((t) => {
        const rest = t.tags!.filter((x) => tagKey(x) !== tagKey(props.tag) && tagKey(x) !== tagKey(next));
        t.tags = [...rest, next];
      });
    nav.toast('Tag renamed');
    props.onClose();
  };

  const removeTag = async () => {
    await db.transactions
      .filter((t) => hasTag(t, props.tag))
      .modify((t) => {
        t.tags = t.tags!.filter((x) => tagKey(x) !== tagKey(props.tag));
        if (!t.tags.length) delete t.tags;
      });
    nav.toast('Tag removed');
    props.onClose();
  };

  return (
    <Sheet title={`#${props.tag}`} onClose={props.onClose} onSave={name.trim() !== props.tag ? rename : undefined} saveLabel="Rename">
      <div class="hero-card">
        <span class="card-label">Spent</span>
        <span class="hero-number">{formatMoney(total, { whole: true })}</span>
        <span class="card-sub">
          {tagged.length} transaction{tagged.length === 1 ? '' : 's'}
          {tagged.length ? ` · ${formatDay(tagged.reduce((m, t) => (t.date < m ? t.date : m), tagged[0].date))} to ${formatDay(tagged.reduce((m, t) => (t.date > m ? t.date : m), tagged[0].date))}` : ''}
        </span>
      </div>
      {byCat.length > 0 && (
        <Section title="By category">
          <RankedBars
            items={byCat.map(([id, v]) => ({
              key: id,
              label: (
                <>
                  <span aria-hidden="true">{cats.get(id)?.emoji}</span> {cats.get(id)?.name ?? 'Other'}
                </>
              ),
              value: v,
            }))}
          />
        </Section>
      )}
      <Section>
        <button
          type="button"
          class="row link-row"
          onClick={() => {
            nav.showActivity({ tag: props.tag });
            props.onClose();
          }}
        >
          View {tagged.length} Transaction{tagged.length === 1 ? '' : 's'}
        </button>
      </Section>
      <Section title="Name">
        <Field label="Tag">
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Tag name" />
        </Field>
      </Section>
      <Section>
        <button type="button" class="row danger-row" onClick={() => setConfirm(true)}>
          Remove Tag from All
        </button>
      </Section>
      {confirm && (
        <ActionSheet
          message={`Remove #${props.tag} from ${tagged.length} transaction${tagged.length === 1 ? '' : 's'}? The transactions stay.`}
          actions={[{ label: 'Remove Tag', destructive: true, onClick: removeTag }]}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Sheet>
  );
}

/**
 * Tag a trip: pick a tag and dates, and every transaction in that range is offered (spending
 * preselected; card payments, transfers and income not).
 */
export function TagTripSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const txns = useLiveQuery(() => db.transactions.toArray(), []);
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const today = todayISO();
  const [tag, setTag] = useState('');
  const [from, setFrom] = useState(addDays(today, -7));
  const [to, setTo] = useState(today);
  const [off, setOff] = useState<Set<string>>(new Set());
  const known = useMemo(() => (txns ? allTags(txns).map((t) => t.tag) : []), [txns]);
  if (!txns) return null;

  const inRange = txns.filter((t) => t.date >= from && t.date <= to).sort((a, b) => (a.date < b.date ? -1 : 1));
  const spending = (t: Transaction) => cats.get(t.categoryId)?.group === 'expense' || !!t.splits?.length;
  // Spending starts ticked; you can tick or untick anything.
  const picked = inRange.filter((t) => (spending(t) ? !off.has(t.id) : off.has(t.id)));
  const toggle = (id: string) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOff(next);
  };

  const apply = async () => {
    const clean = cleanTag(tag, known);
    if (!clean) return;
    await db.transactions.bulkUpdate(
      picked.map((t) => ({ key: t.id, changes: { tags: [...(t.tags ?? []).filter((x) => tagKey(x) !== tagKey(clean)), clean] } })),
    );
    nav.toast(`Tagged ${picked.length} transaction${picked.length === 1 ? '' : 's'} #${clean}`);
    props.onClose();
  };

  return (
    <Sheet title="Tag a Trip" onClose={props.onClose} onSave={apply} saveLabel={`Tag ${picked.length}`} saveDisabled={!tag.trim() || !picked.length}>
      <Section>
        <Field label="Tag">
          <input list="trip-tags" value={tag} placeholder="e.g. Italy 2026" aria-label="Trip tag" onInput={(e) => setTag((e.target as HTMLInputElement).value)} />
          <datalist id="trip-tags">
            {known.map((k) => (
              <option value={k} />
            ))}
          </datalist>
        </Field>
        <Field label="From">
          <input type="date" value={from} aria-label="From" onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="To">
          <input type="date" value={to} aria-label="To" onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      <Section title={`${inRange.length} transactions in these dates`} footer="Spending is ticked; card payments, transfers and income aren't. Tap to change.">
        {inRange.map((t) => {
          const on = picked.includes(t);
          return (
            <label class="row check-row">
              <input type="checkbox" checked={on} onChange={() => toggle(t.id)} aria-label={`${t.payee} ${formatDay(t.date)}`} />
              <CategoryIcon category={cats.get(t.categoryId)} size="sm" />
              <span class="row-main">
                <span class="row-title">{t.payee}</span>
                <span class="row-subtitle">{formatDay(t.date)}</span>
              </span>
              <span class="row-detail">{formatMoney(t.amount)}</span>
            </label>
          );
        })}
      </Section>
    </Sheet>
  );
}
