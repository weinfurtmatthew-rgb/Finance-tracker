import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useCategories, useRules } from '../hooks';
import { useNav } from '../nav';
import type { Rule } from '../types';
import { Empty, Field, Row, Section, Sheet, Toggle, CategorySelect } from '../components/ui';

function RuleEditor(props: { rule?: Rule; onClose: () => void }) {
  const nav = useNav();
  const categories = useCategories();
  const r = props.rule;
  const [match, setMatch] = useState(r?.match ?? '');
  const [payee, setPayee] = useState(r?.payee ?? '');
  const [categoryId, setCategoryId] = useState(r?.categoryId ?? '');
  const [apply, setApply] = useState(true);

  const save = async () => {
    const rule: Rule = {
      id: r?.id ?? newId(),
      match: match.trim(),
      payee: payee.trim() || undefined,
      categoryId: categoryId || undefined,
      createdAt: r?.createdAt ?? Date.now(),
    };
    await db.rules.put(rule);
    let n = 0;
    if (apply) {
      const needle = rule.match.toLowerCase();
      await db.transactions
        .filter((t) => `${t.description}\n${t.payee}`.toLowerCase().includes(needle))
        .modify((t) => {
          if (rule.payee) t.payee = rule.payee;
          if (rule.categoryId) t.categoryId = rule.categoryId;
          n++;
        });
    }
    nav.toast(n ? `Rule saved · ${n} transactions updated` : 'Rule saved');
    props.onClose();
  };

  const remove = async () => {
    await db.rules.delete(r!.id);
    props.onClose();
  };

  return (
    <Sheet title={r ? 'Edit Rule' : 'New Rule'} onClose={props.onClose} onSave={save} saveDisabled={!match.trim() || (!payee.trim() && !categoryId)}>
      <Section title="When the bank description contains" footer="Not case sensitive. For example “NETFLIX” or “SHELL OIL”.">
        <Field label="Text">
          <input value={match} onInput={(e) => setMatch((e.target as HTMLInputElement).value)} autoFocus={!r} />
        </Field>
      </Section>
      <Section title="Then">
        <Field label="Rename to">
          <input value={payee} placeholder="Keep as is" onInput={(e) => setPayee((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Category">
          <CategorySelect
            categories={[{ id: '', name: 'Keep as is', emoji: '', color: '', group: 'expense', order: -1 }, ...categories]}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
      </Section>
      <Section>
        <Toggle checked={apply} onChange={setApply} label="Also update existing transactions" />
      </Section>
      {r && (
        <Section>
          <button type="button" class="row danger-row" onClick={remove}>
            Delete Rule
          </button>
        </Section>
      )}
    </Sheet>
  );
}

export function RulesSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const rules = useRules();
  const categories = useCategories();
  const cats = new Map(categories.map((c) => [c.id, c]));
  const edit = (r?: Rule) => nav.present((close) => <RuleEditor rule={r} onClose={close} />);
  return (
    <Sheet title="Rules" onClose={props.onClose}>
      {rules.length === 0 ? (
        <Empty icon="🪄" title="No rules yet">
          <p>When you change the category of an imported transaction, the app offers to make a rule, so the next import gets it right automatically.</p>
        </Empty>
      ) : (
        <Section footer="The most specific (longest) match wins. Rules apply to new imports.">
          {rules.map((r) => {
            const c = r.categoryId ? cats.get(r.categoryId) : undefined;
            return (
              <Row
                title={`“${r.match}”`}
                subtitle={[r.payee && `Rename to ${r.payee}`, c && `${c.emoji} ${c.name}`].filter(Boolean).join(' · ')}
                onClick={() => edit(r)}
              />
            );
          })}
        </Section>
      )}
      <Section>
        <button type="button" class="row link-row" onClick={() => edit()}>
          Add Rule
        </button>
      </Section>
    </Sheet>
  );
}
