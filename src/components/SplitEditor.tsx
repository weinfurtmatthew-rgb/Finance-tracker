import type { Category, Cents } from '../types';
import { centsToInput, formatMoney, parseUserAmount } from '../lib/money';
import { CategorySelect, Section, Toggle } from './ui';

/** A part being edited: amounts are typed as positive numbers, like the main amount. */
export interface PartDraft {
  id: string;
  amount: string;
  categoryId: string;
  forSomeone: boolean;
  owedBy: string;
  settledBy?: string;
}

export const partCents = (p: PartDraft) => parseUserAmount(p.amount) ?? 0;

/**
 * Split one transaction into parts, each with its own category. A part can be "for someone else": it
 * goes on your Owed to You list instead of counting as your spending.
 */
export function SplitEditor(props: {
  total: Cents;
  parts: PartDraft[];
  onChange: (parts: PartDraft[]) => void;
  onRemoveSplit: () => void;
  onAddPart: () => void;
  categories: Category[];
  people: string[];
  money: 'in' | 'out';
}) {
  const { parts, total } = props;
  const assigned = parts.reduce((s, p) => s + partCents(p), 0);
  const left = total - assigned;
  const set = (id: string, patch: Partial<PartDraft>) => props.onChange(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <Section
      title={
        <>
          <span>Split</span>
          <button type="button" class="link" onClick={props.onRemoveSplit}>
            Don't split
          </button>
        </>
      }
      footer={
        left === 0 ? (
          <span class="pos-text">✓ Parts add up to {formatMoney(total)}</span>
        ) : (
          <span class="warn-text">
            {left > 0 ? `${formatMoney(left)} left to assign` : `${formatMoney(-left)} too much`} (total {formatMoney(total)})
          </span>
        )
      }
    >
      <datalist id="owed-people">
        {props.people.map((p) => (
          <option value={p} />
        ))}
      </datalist>
      {parts.map((p, i) => (
        <div class="split-part">
          <div class="split-top">
            <span class="split-num" aria-hidden="true">
              {i + 1}
            </span>
            <input
              class="split-amount"
              inputMode="decimal"
              placeholder="0.00"
              aria-label={`Part ${i + 1} amount`}
              value={p.amount}
              onInput={(e) => set(p.id, { amount: (e.target as HTMLInputElement).value })}
            />
            {!p.forSomeone && (
              <CategorySelect
                class="chip"
                aria-label={`Part ${i + 1} category`}
                categories={props.categories.filter((c) => c.group !== 'transfer' || c.id === p.categoryId)}
                value={p.categoryId}
                onChange={(id) => set(p.id, { categoryId: id })}
              />
            )}
            {parts.length > 2 && (
              <button type="button" class="icon-button small" aria-label={`Remove part ${i + 1}`} onClick={() => props.onChange(parts.filter((x) => x.id !== p.id))}>
                ✕
              </button>
            )}
          </div>
          <div class="split-bottom">
            {left !== 0 && (
              <button type="button" class="link small" onClick={() => set(p.id, { amount: centsToInput(partCents(p) + left) })}>
                Put the rest here
              </button>
            )}
            {props.money === 'out' && (
              <Toggle checked={p.forSomeone} onChange={(v) => set(p.id, { forSomeone: v })} label="For someone else" />
            )}
            {p.forSomeone && (
              <input
                class="owed-name"
                list="owed-people"
                placeholder="Who owes you? e.g. Alex, Work"
                aria-label={`Part ${i + 1} owed by`}
                value={p.owedBy}
                onInput={(e) => set(p.id, { owedBy: (e.target as HTMLInputElement).value })}
              />
            )}
          </div>
        </div>
      ))}
      <button type="button" class="row link-row" onClick={props.onAddPart}>
        Add a Part
      </button>
    </Section>
  );
}
