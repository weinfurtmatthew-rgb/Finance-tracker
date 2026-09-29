import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Category, CategoryGroup } from '../types';
import { CARD_PAYMENT, OWED, TRANSFER, UNCATEGORIZED } from '../lib/categories';
import { ActionSheet, CategoryIcon, CategorySelect, Field, Row, Section, Segmented, Sheet, Toggle } from '../components/ui';

const PROTECTED = new Set([UNCATEGORIZED, TRANSFER, CARD_PAYMENT, OWED]);
const EMOJIS = ['🛒', '🍽️', '☕', '🍺', '🍕', '🚗', '⛽', '🚌', '✈️', '🏨', '🏠', '💡', '📱', '💻', '🛍️', '👕', '👟', '💄', '💇', '🩺', '💊', '🏋️', '🧘', '⚽', '🎬', '🎮', '🎵', '📚', '🎓', '🐾', '🧸', '👶', '🎁', '💝', '🌱', '🔨', '🧹', '🧾', '🏛️', '💳', '💵', '💰', '📈', '🏦', '🤝', '🎉', '💍', '⛪', '🚬', '📦'];
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];

/** Move everything filed under `from` to `to` (split parts, rules, bills and budgets too), then delete `from`. */
export async function moveCategory(from: string, to: string) {
  await db.transaction('rw', [db.categories, db.transactions, db.rules, db.recurring, db.budgets], async () => {
    await db.transactions
      .filter((t) => t.categoryId === from || !!t.splits?.some((p) => p.categoryId === from))
      .modify((t) => {
        if (t.categoryId === from) t.categoryId = to;
        if (t.splits) t.splits = t.splits.map((p) => (p.categoryId === from ? { ...p, categoryId: to } : p));
      });
    await db.rules.filter((r) => r.categoryId === from).modify((r) => {
      if (to === UNCATEGORIZED) delete r.categoryId;
      else r.categoryId = to;
    });
    await db.recurring.filter((r) => r.categoryId === from).modify((r) => {
      r.categoryId = to === UNCATEGORIZED ? undefined : to;
    });
    const budget = await db.budgets.get(from);
    if (budget) {
      const existing = await db.budgets.get(to);
      // Merging two budgets adds their limits; deleting a category drops its budget.
      if (to !== UNCATEGORIZED) await db.budgets.put({ ...budget, categoryId: to, limit: budget.limit + (existing?.limit ?? 0) });
      await db.budgets.delete(from);
    }
    await db.categories.delete(from);
  });
}

export function CategoryEditor(props: { category?: Category; group?: CategoryGroup; onClose: () => void; onCreated?: (id: string) => void }) {
  const nav = useNav();
  const c = props.category;
  const [name, setName] = useState(c?.name ?? '');
  const [emoji, setEmoji] = useState(c?.emoji ?? '📁');
  const [color, setColor] = useState(c?.color ?? COLORS[5]);
  const [group, setGroup] = useState<CategoryGroup>(c?.group ?? props.group ?? 'expense');
  const [hidden, setHidden] = useState(!!c?.hidden);
  const [confirm, setConfirm] = useState<null | 'delete' | 'merge'>(null);
  const [mergeInto, setMergeInto] = useState('');
  const categories = useCategories();
  const locked = !!c && PROTECTED.has(c.id);

  const save = async () => {
    // New categories go at the end of their group.
    const inGroup = categories.filter((x) => x.group === group);
    const order = c?.order ?? (inGroup.length ? Math.max(...inGroup.map((x) => x.order)) + 0.01 : 100);
    const id = c?.id ?? newId();
    const record: Category = { id, name: name.trim(), emoji: [...emoji.trim()].slice(0, 2).join('') || '📁', color, group, order };
    if (hidden) record.hidden = true;
    await db.categories.put(record);
    props.onCreated?.(id);
    props.onClose();
  };

  const remove = async () => {
    await moveCategory(c!.id, UNCATEGORIZED);
    nav.toast('Category deleted');
    props.onClose();
  };

  const merge = async () => {
    const target = categories.find((x) => x.id === mergeInto);
    if (!target) return;
    await moveCategory(c!.id, target.id);
    nav.toast(`Merged into ${target.name}`);
    props.onClose();
  };

  return (
    <Sheet title={c ? 'Edit Category' : 'New Category'} onClose={props.onClose} onSave={save} saveDisabled={!name.trim()}>
      <Section>
        <Field label="Name">
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} autoFocus={!c} />
        </Field>
        <Field label="Emoji">
          <input value={emoji} onInput={(e) => setEmoji((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      <Section title="Pick an emoji">
        <div class="emoji-grid">
          {EMOJIS.map((e) => (
            <button type="button" class={`emoji-pick ${e === emoji ? 'on' : ''}`} aria-label={e} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
      </Section>
      {!locked && (
        <Section title="Type" footer="Transfers (like moving money to savings or paying your credit card) don't count as spending or income.">
          <div class="padded-sm">
            <Segmented
              value={group}
              onChange={setGroup}
              options={[
                { value: 'expense', label: 'Spending' },
                { value: 'income', label: 'Income' },
                { value: 'transfer', label: 'Transfer' },
              ]}
            />
          </div>
        </Section>
      )}
      <Section title="Color">
        <div class="swatches">
          {COLORS.map((col) => (
            <button type="button" aria-label={col} class={`swatch ${col === color ? 'on' : ''}`} style={{ background: col }} onClick={() => setColor(col)} />
          ))}
        </div>
      </Section>
      {!locked && (
        <Section footer="Hidden categories don't appear when you pick a category; transactions already in them stay.">
          <Toggle checked={hidden} onChange={setHidden} label="Hide from pickers" />
        </Section>
      )}
      {c && !locked && (
        <Section
          title="Merge"
          footer="Moves every transaction, rule, bill and budget from this category into another one, then removes this one."
        >
          <Field label="Merge into">
            <CategorySelect
              categories={categories.filter((x) => x.id !== c.id && x.group === c.group)}
              value={mergeInto}
              onChange={setMergeInto}
              allowNew={false}
              aria-label="Merge into"
            />
          </Field>
          <button type="button" class="row link-row" disabled={!mergeInto} onClick={() => setConfirm('merge')}>
            Merge
          </button>
        </Section>
      )}
      {c && !locked && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setConfirm('delete')}>
            Delete Category
          </button>
        </Section>
      )}
      {confirm === 'delete' && (
        <ActionSheet
          message={`Delete “${c!.name}”? Its transactions will become Uncategorized.`}
          actions={[{ label: 'Delete Category', destructive: true, onClick: remove }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'merge' && (
        <ActionSheet
          message={`Merge “${c!.name}” into “${categories.find((x) => x.id === mergeInto)?.name}”? This can't be undone.`}
          actions={[{ label: 'Merge', destructive: true, onClick: merge }]}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Sheet>
  );
}

export function CategoriesSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const categories = useCategories();
  const txns = useTransactions();
  const [reorder, setReorder] = useState(false);
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  const edit = (c?: Category, group?: CategoryGroup) => nav.present((close) => <CategoryEditor category={c} group={group} onClose={close} />);
  const groups: [string, CategoryGroup][] = [
    ['Spending', 'expense'],
    ['Income', 'income'],
    ['Transfers', 'transfer'],
  ];
  /** Swap a category with its neighbour in the same group. */
  const move = async (list: Category[], i: number, dir: -1 | 1) => {
    const a = list[i];
    const b = list[i + dir];
    if (!b) return;
    await db.transaction('rw', db.categories, async () => {
      await db.categories.update(a.id, { order: b.order });
      await db.categories.update(b.id, { order: a.order });
    });
  };
  return (
    <Sheet title="Categories" onClose={props.onClose}>
      <div class="sheet-toolbar">
        <button type="button" class="link" onClick={() => setReorder(!reorder)}>
          {reorder ? 'Done Reordering' : 'Reorder'}
        </button>
      </div>
      {groups.map(([title, g]) => {
        const list = categories.filter((c) => c.group === g);
        return (
          <Section title={title}>
            {list.map((c, i) =>
              reorder ? (
                <div class="row">
                  <span class="row-icon">
                    <CategoryIcon category={c} size="sm" />
                  </span>
                  <span class="row-main">
                    <span class="row-title">{c.name}</span>
                  </span>
                  <button type="button" class="icon-button small" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(list, i, -1)}>
                    ↑
                  </button>
                  <button type="button" class="icon-button small" aria-label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(list, i, 1)}>
                    ↓
                  </button>
                </div>
              ) : (
                <Row
                  icon={<CategoryIcon category={c} size="sm" />}
                  title={c.name}
                  subtitle={c.hidden ? 'Hidden' : undefined}
                  detail={counts.get(c.id) ?? 0}
                  onClick={() => edit(c)}
                />
              ),
            )}
          </Section>
        );
      })}
      <Section>
        <button type="button" class="row link-row" onClick={() => edit()}>
          Add Category
        </button>
      </Section>
    </Sheet>
  );
}
