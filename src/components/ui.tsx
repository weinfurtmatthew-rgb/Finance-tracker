import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Category, Cents } from '../types';
import { formatMoney } from '../lib/money';

export function Sheet(props: {
  title: string;
  onClose: () => void;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  closeLabel?: string;
  children: ComponentChildren;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div class={`sheet-backdrop ${shown ? 'shown' : ''}`}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <header class="sheet-header">
          <button type="button" class="link" onClick={props.onClose}>
            {props.closeLabel ?? (props.onSave ? 'Cancel' : 'Done')}
          </button>
          <h2>{props.title}</h2>
          {props.onSave ? (
            <button type="button" class="link strong" disabled={props.saveDisabled} onClick={props.onSave}>
              {props.saveLabel ?? 'Save'}
            </button>
          ) : (
            <span class="spacer" />
          )}
        </header>
        <div class="sheet-body">{props.children}</div>
      </div>
    </div>
  );
}

export function Section(props: { title?: ComponentChildren; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="section">
      {props.title && <h3 class="section-title">{props.title}</h3>}
      <div class="group">{props.children}</div>
      {props.footer && <p class="section-footer">{props.footer}</p>}
    </section>
  );
}

export function Row(props: {
  icon?: ComponentChildren;
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  detail?: ComponentChildren;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  const content = (
    <>
      {props.icon && <span class="row-icon">{props.icon}</span>}
      <span class="row-main">
        <span class={`row-title ${props.danger ? 'danger' : ''}`}>{props.title}</span>
        {props.subtitle && <span class="row-subtitle">{props.subtitle}</span>}
      </span>
      {props.detail != null && <span class="row-detail">{props.detail}</span>}
      {(props.chevron ?? !!props.onClick) && <span class="chevron" aria-hidden="true">›</span>}
    </>
  );
  return props.onClick ? (
    <button type="button" class="row" onClick={props.onClick}>
      {content}
    </button>
  ) : (
    <div class="row">{content}</div>
  );
}

export function Field(props: { label: string; children: ComponentChildren; hint?: ComponentChildren }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      <span class="field-control">{props.children}</span>
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Money(props: { cents: Cents; colored?: boolean; whole?: boolean; class?: string }) {
  const cls = props.colored ? (props.cents > 0 ? 'pos' : props.cents < 0 ? '' : 'muted') : '';
  return (
    <span class={`money ${cls} ${props.class ?? ''}`}>{formatMoney(props.cents, { whole: props.whole, sign: props.colored })}</span>
  );
}

export function CategoryIcon(props: { category?: Category; size?: 'sm' | 'md' }) {
  const color = props.category?.color ?? '#c7c7cc';
  return (
    <span class={`cat-icon ${props.size ?? 'md'}`} style={{ background: `${color}33` }} aria-hidden="true">
      {props.category?.emoji ?? '❔'}
    </span>
  );
}

export function Empty(props: { icon: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-icon" aria-hidden="true">
        {props.icon}
      </div>
      <h3>{props.title}</h3>
      {props.children}
    </div>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="tablist">
      {props.options.map((o) => (
        <button
          type="button"
          role="tab"
          aria-selected={o.value === props.value}
          class={o.value === props.value ? 'active' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="toggle-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        class="switch"
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
    </label>
  );
}

export function CategorySelect(props: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
} & Omit<JSX.HTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  const { categories, value, onChange, ...rest } = props;
  const groups: [string, Category['group']][] = [
    ['Spending', 'expense'],
    ['Income', 'income'],
    ['Transfers', 'transfer'],
  ];
  return (
    <select {...rest} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {groups.map(([label, group]) => (
        <optgroup label={label}>
          {categories
            .filter((c) => c.group === group)
            .map((c) => (
              <option value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** A bottom action sheet with a message and a list of choices. */
export function ActionSheet(props: {
  title?: string;
  message?: ComponentChildren;
  actions: { label: string; onClick: () => void; destructive?: boolean; bold?: boolean }[];
  onCancel: () => void;
}) {
  return (
    <div class="action-backdrop" onClick={props.onCancel}>
      <div class="action-sheet" role="alertdialog" onClick={(e) => e.stopPropagation()}>
        <div class="action-group">
          {(props.title || props.message) && (
            <div class="action-header">
              {props.title && <strong>{props.title}</strong>}
              {props.message && <p>{props.message}</p>}
            </div>
          )}
          {props.actions.map((a) => (
            <button type="button" class={`action ${a.destructive ? 'danger' : ''} ${a.bold ? 'strong' : ''}`} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
        <button type="button" class="action action-cancel strong" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
