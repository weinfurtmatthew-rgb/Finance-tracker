import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Category, CategoryGroup } from '../types';
import { CARD_PAYMENT, TRANSFER, UNCATEGORIZED } from '../lib/categories';
import { ActionSheet, CategoryIcon, Field, Row, Section, Segmented, Sheet } from '../components/ui';

const PROTECTED = new Set([UNCATEGORIZED, TRANSFER, CARD_PAYMENT]);
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];

function CategoryEditor(props: { category?: Category; onClose: () => void }) {
  const nav = useNav();
  const c = props.category;
  const [name, setName] = useState(c?.name ?? '');
  const [emoji, setEmoji] = useState(c?.emoji ?? '📁');
  const [color, setColor] = useState(c?.color ?? COLORS[5]);
  const [group, setGroup] = useState<CategoryGroup>(c?.group ?? 'expense');
  const [confirm, setConfirm] = useState(false);
  const locked = !!c && PROTECTED.has(c.id);

  const save = async () => {
    const order = c?.order ?? ((await db.categories.orderBy('order').last())?.order ?? 0) + 1;
    await db.categories.put({ id: c?.id ?? newId(), name: name.trim(), emoji: [...emoji.trim()].slice(0, 2).join('') || '📁', color, group, order });
    props.onClose();
  };

  const remove = async () => {
    await db.transaction('rw', db.categories, db.transactions, db.rules, async () => {
      await db.transactions.where('categoryId').equals(c!.id).modify({ categoryId: UNCATEGORIZED });
      await db.rules.filter((r) => r.categoryId === c!.id).modify((r) => void delete r.categoryId);
      await db.categories.delete(c!.id);
    });
    nav.toast('Category deleted');
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
      {c && !locked && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => setConfirm(true)}>
            Delete Category
          </button>
        </Section>
      )}
      {confirm && (
        <ActionSheet
          message={`Delete “${c!.name}”? Its transactions will become Uncategorized.`}
          actions={[{ label: 'Delete Category', destructive: true, onClick: remove }]}
          onCancel={() => setConfirm(false)}
        />
      )}
    </Sheet>
  );
}

export function CategoriesSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const categories = useCategories();
  const txns = useTransactions();
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  const edit = (c?: Category) => nav.present((close) => <CategoryEditor category={c} onClose={close} />);
  const groups: [string, CategoryGroup][] = [
    ['Spending', 'expense'],
    ['Income', 'income'],
    ['Transfers', 'transfer'],
  ];
  return (
    <Sheet title="Categories" onClose={props.onClose}>
      {groups.map(([title, g]) => (
        <Section title={title}>
          {categories
            .filter((c) => c.group === g)
            .map((c) => (
              <Row icon={<CategoryIcon category={c} size="sm" />} title={c.name} detail={counts.get(c.id) ?? 0} onClick={() => edit(c)} />
            ))}
        </Section>
      ))}
      <Section>
        <button type="button" class="row link-row" onClick={() => edit()}>
          Add Category
        </button>
      </Section>
    </Sheet>
  );
}
