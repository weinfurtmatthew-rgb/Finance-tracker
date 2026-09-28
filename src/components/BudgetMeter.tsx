import type { Category } from '../types';
import { formatMoney } from '../lib/money';
import type { BudgetProgress } from '../lib/budgets';

export function budgetStatusText(p: BudgetProgress): { icon: string; text: string } {
  const pct = Math.round(p.ratio * 100);
  if (p.state === 'over') return { icon: '⛔', text: `Over by ${formatMoney(-p.remaining, { whole: true })}` };
  if (p.state === 'warning') return { icon: '⚠️', text: `${pct}% used · ${formatMoney(p.remaining, { whole: true })} left` };
  if (p.offPace && p.projected != null) return { icon: '📈', text: `On pace for ${formatMoney(p.projected, { whole: true })} (+${formatMoney(p.projected - p.limit, { whole: true })})` };
  return { icon: '', text: `${formatMoney(p.remaining, { whole: true })} left` };
}

export function BudgetMeter(props: { progress: BudgetProgress; category?: Category; elapsed: number; onClick?: () => void }) {
  const p = props.progress;
  const status = budgetStatusText(p);
  const trackClass = p.state === 'ok' ? '' : p.state;
  return (
    <button type="button" class="meter-row" onClick={props.onClick}>
      <span class="meter-head">
        <span>
          <span aria-hidden="true">{props.category?.emoji}</span> {props.category?.name ?? 'Unknown'}
        </span>
        <span class="muted">
          {formatMoney(p.spent, { whole: true })} of {formatMoney(p.limit, { whole: true })}
        </span>
      </span>
      <span
        class={`meter-track ${trackClass}`}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={p.limit / 100}
        aria-valuenow={p.spent / 100}
        aria-label={`${props.category?.name}: ${status.text}`}
      >
        <span class="meter-fill" style={{ width: `${Math.min(100, p.ratio * 100)}%` }} />
        {props.elapsed > 0 && props.elapsed < 1 && <span class="meter-pace" style={{ left: `calc(${props.elapsed * 100}% - 1px)` }} title="Where you'd be at an even pace" />}
      </span>
      <span class="meter-sub">
        {status.icon && <span aria-hidden="true">{status.icon} </span>}
        <span class={p.state !== 'ok' || p.offPace ? 'status' : ''}>{status.text}</span>
      </span>
    </button>
  );
}
