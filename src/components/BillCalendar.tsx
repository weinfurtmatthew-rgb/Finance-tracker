import { useMemo, useState } from 'preact/hooks';
import { pushTo } from '../lib/collections';
import type { Category } from '../types';
import { addMonths, dayInMonth, daysInMonth, monthKey, monthLabel } from '../lib/dates';
import { isOutflow, nextOnSchedule, occurrences, type RecurringStatus } from '../lib/recurring';
import { formatMoney } from '../lib/money';
import { RecurringRow } from './RecurringRow';

interface Entry {
  status: RecurringStatus;
  date: string;
}

export function BillCalendar(props: { statuses: RecurringStatus[]; today: string; categories: Map<string, Category> }) {
  const [month, setMonth] = useState(monthKey(props.today));
  const [selected, setSelected] = useState<string | null>(props.today);

  const entries = useMemo(() => {
    const first = `${month}-01`;
    const last = dayInMonth(first, 0, 31);
    const out: Entry[] = [];
    for (const s of props.statuses) {
      if (s.rec.status !== 'active') continue;
      if (s.rec.kind === 'trial') {
        if (s.nextDue >= first && s.nextDue <= last) out.push({ status: s, date: s.nextDue });
        continue;
      }
      // Past charges in this month come from history; future ones from the schedule.
      for (const t of s.history) if (t.date >= first && t.date <= last) out.push({ status: s, date: t.date });
      let d = s.nextDue;
      while (d < first) d = nextOnSchedule(d, s.rec);
      for (const o of occurrences(d, last, s.rec)) if (o >= props.today || o === s.nextDue) out.push({ status: s, date: o });
    }
    return out;
  }, [props.statuses, month, props.today]);

  const byDay = new Map<string, Entry[]>();
  for (const e of entries) pushTo(byDay, e.date, e);
  const [y, m] = month.split('-').map(Number);
  const leading = new Date(y, m - 1, 1).getDay();
  const total = entries.filter((e) => isOutflow(e.status.rec)).reduce((s, e) => s + Math.abs(e.status.expected), 0);
  const dayList = selected && selected.startsWith(month) ? byDay.get(selected) ?? [] : [];

  return (
    <div class="calendar">
      <div class="cal-head">
        <button type="button" class="icon-button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </button>
        <div class="cal-title">
          <strong>{monthLabel(month)}</strong>
          <span class="muted small">{formatMoney(total, { whole: true })} in bills</span>
        </div>
        <button type="button" class="icon-button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </button>
      </div>
      <div class="cal-grid" role="grid">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => (
          <span class="cal-dow">{d}</span>
        ))}
        {Array.from({ length: leading }, () => (
          <span />
        ))}
        {Array.from({ length: daysInMonth(y, m) }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const items = byDay.get(date) ?? [];
          return (
            <button
              type="button"
              class={`cal-day ${date === props.today ? 'today' : ''} ${date === selected ? 'selected' : ''} ${date < props.today ? 'past' : ''}`}
              onClick={() => setSelected(date)}
              aria-label={`${date}: ${items.length} due`}
            >
              <span class="cal-num">{i + 1}</span>
              <span class="cal-dots">
                {items.slice(0, 3).map((e) => (
                  <i style={{ background: e.status.rec.kind === 'income' ? 'var(--green)' : props.categories.get(e.status.rec.categoryId ?? '')?.color ?? 'var(--tint)' }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {selected && selected.startsWith(month) && (
        <section class="section">
          <h3 class="section-title">{new Date(selected + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
          <div class="group">
            {dayList.length === 0 ? (
              <div class="row muted">Nothing due.</div>
            ) : (
              dayList.map((e) => (
                <RecurringRow
                  status={e.status}
                  today={props.today}
                  date={e.date}
                  late={false}
                  subtitle={e.date < props.today ? 'Charged' : undefined}
                  category={props.categories.get(e.status.rec.categoryId ?? '')}
                />
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
