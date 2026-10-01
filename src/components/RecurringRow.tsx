import type { Category } from '../types';
import { useNav } from '../nav';
import { diffDays, formatShortDate } from '../lib/dates';
import { FREQUENCIES, type RecurringStatus } from '../lib/recurring';
import { CategoryIcon, KindIcon, Money } from './ui';
import { RecurringDetail } from '../screens/RecurringDetail';

export function dueLabel(date: string, today: string, late: boolean): string {
  if (late) return `Not seen yet · due ${formatShortDate(date)}`;
  const d = diffDays(today, date);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d < 7) return `Due in ${d} days · ${formatShortDate(date)}`;
  return `Due ${formatShortDate(date)}`;
}

export function RecurringRow(props: {
  status: RecurringStatus;
  category?: Category;
  today: string;
  date?: string;
  late?: boolean;
  subtitle?: string;
}) {
  const nav = useNav();
  const { status: s } = props;
  const r = s.rec;
  const date = props.date ?? s.nextDue;
  const cancelled = r.status === 'cancelled';
  const subtitle =
    props.subtitle ??
    (cancelled
      ? `Cancelled ${r.cancelledOn ? formatShortDate(r.cancelledOn) : ''}`
      : r.kind === 'trial'
        ? `Trial ends ${formatShortDate(r.trialEndsOn ?? date)}`
        : `${dueLabel(date, props.today, props.late ?? s.late)} · ${FREQUENCIES[r.frequency].label}`);
  return (
    <button type="button" class="row txn-row" onClick={() => nav.present((close) => <RecurringDetail id={r.id} onClose={close} />)}>
      {props.category ? <CategoryIcon category={props.category} /> : <KindIcon kind={r.kind} />}
      <span class="row-main">
        <span class="row-title">
          {r.name}
          {s.priceChange && <span class="badge warn">Price up</span>}
        </span>
        <span class={`row-subtitle ${(props.late ?? s.late) && !cancelled ? 'warn-text' : ''}`}>{subtitle}</span>
      </span>
      <span class={`row-detail ${cancelled ? 'muted' : ''}`}>
        <Money cents={s.expected} colored={r.kind === 'income'} />
      </span>
    </button>
  );
}
