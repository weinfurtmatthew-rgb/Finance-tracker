import { useMemo, useState } from 'preact/hooks';
import { byId, useCategories } from '../hooks';
import { useNav } from '../nav';
import { useRecurringModel, type Alert } from '../recurringModel';
import type { RecurringKind } from '../types';
import { addDays, dayInMonth, formatShortDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { KINDS, monthlyCost, type UpcomingItem } from '../lib/recurring';
import { dismissAlert } from '../lib/recurringActions';
import { Empty, Money, Section, Segmented } from '../components/ui';
import { RecurringRow } from '../components/RecurringRow';
import { BillCalendar } from '../components/BillCalendar';
import { Icons } from '../components/icons';
import { RecurringEditor } from './RecurringEditor';
import { RecurringReview } from './RecurringReview';
import { RecurringDetail } from './RecurringDetail';

type View = 'upcoming' | 'calendar' | 'all';

export function AlertCard(props: { alert: Alert }) {
  const nav = useNav();
  const { alert: a } = props;
  const r = a.status.rec;
  const open = () => nav.present((close) => <RecurringDetail id={r.id} onClose={close} />);
  const text = {
    price: () => {
      const p = a.status.priceChange!;
      return [`${r.name} went up`, `${formatMoney(Math.abs(p.from))} → ${formatMoney(Math.abs(p.to))} on ${formatShortDate(p.date)}.`];
    },
    'after-cancel': () => [`${r.name} charged after you cancelled`, `${formatMoney(Math.abs(a.status.chargedAfterCancel!.amount))} on ${formatShortDate(a.status.chargedAfterCancel!.date)}. Check that the cancellation went through.`],
    'trial-ending': () => [`${r.name} trial ends ${formatShortDate(r.trialEndsOn!)}`, `Then about ${formatMoney(Math.abs(a.status.expected))}. Cancel before then if you don't want it.`],
    'trial-ended': () => [`${r.name} trial ended`, 'Did you cancel it or keep it? Tap to update.'],
  }[a.type]();
  return (
    <div class={`callout ${a.type === 'after-cancel' ? 'danger' : 'warn'}`}>
      <button type="button" class="callout-body" onClick={open}>
        <strong>{text[0]}</strong>
        <p>{text[1]}</p>
      </button>
      {a.type !== 'trial-ended' && (
        <button type="button" class="callout-close" aria-label="Dismiss" onClick={() => dismissAlert(a.key)}>
          ✕
        </button>
      )}
    </div>
  );
}

export function Recurring() {
  const nav = useNav();
  const model = useRecurringModel();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const [view, setView] = useState<View>('upcoming');
  const { today } = model;

  if (!model.loaded) return null;
  const add = (kind?: RecurringKind) => nav.present((close) => <RecurringEditor initialKind={kind} onClose={close} />);
  const review = () => nav.present((close) => <RecurringReview onClose={close} />);
  const cat = (id?: string) => (id ? cats.get(id) : undefined);

  const groups: [string, UpcomingItem[]][] = [];
  const endOfMonth = dayInMonth(today, 0, 31);
  const week = addDays(today, 7);
  const bucket = (title: string, items: UpcomingItem[]) => items.length && groups.push([title, items]);
  bucket('Needs attention', model.upcomingItems.filter((i) => i.late));
  bucket('Next 7 days', model.upcomingItems.filter((i) => !i.late && i.date < week));
  bucket('Later this month', model.upcomingItems.filter((i) => !i.late && i.date >= week && i.date <= endOfMonth));
  bucket('Next month', model.upcomingItems.filter((i) => !i.late && i.date > endOfMonth && i.date >= week));

  const kinds: RecurringKind[] = ['subscription', 'bill', 'loan', 'card-payment', 'income', 'trial'];
  const active = model.statuses.filter((s) => s.rec.status === 'active');
  const cancelled = model.statuses.filter((s) => s.rec.status === 'cancelled');
  const totalSaved = cancelled.reduce((s, x) => s + (x.saved ?? 0), 0);
  const nothing = model.recurring.length === 0;

  return (
    <>
      <header class="large-title">
        <h1>Recurring</h1>
        <button type="button" class="icon-button" aria-label="Add recurring" onClick={() => add()}>
          {Icons.plus()}
        </button>
      </header>

      {model.suggestions.length > 0 && (
        <button type="button" class="callout" onClick={review}>
          <strong>
            Found {model.suggestions.length} possible recurring charge{model.suggestions.length === 1 ? '' : 's'}
          </strong>
          <p>Tap to review and confirm them.</p>
        </button>
      )}
      {model.alerts.map((a) => (
        <AlertCard key={a.key} alert={a} />
      ))}

      {nothing ? (
        <Empty icon="repeat" title="No recurring items yet">
          <p>
            {model.suggestions.length
              ? 'Review the suggestions above. They come from the transactions you imported.'
              : 'Import a few months of transactions and the app will find your subscriptions, bills and paychecks. You can also add them yourself.'}
          </p>
          <div class="button-stack">
            <button type="button" class="button" onClick={() => add()}>
              Add Manually
            </button>
            <button type="button" class="button" onClick={() => add('trial')}>
              Track a Free Trial
            </button>
          </div>
        </Empty>
      ) : (
        <>
          <div class="cards">
            <div class="card">
              <span class="card-label">Monthly cost</span>
              <Money cents={model.monthly} whole class="card-value" />
              <span class="card-sub">subscriptions, bills &amp; loans</span>
            </div>
            <div class="card">
              <span class="card-label">Yearly cost</span>
              <Money cents={model.monthly * 12} whole class="card-value" />
              <span class="card-sub">
                <Money cents={model.monthlySubscriptions * 12} whole /> is subscriptions
              </span>
            </div>
            <div class="card">
              <span class="card-label">Due this month</span>
              <Money cents={model.dueThisMonth.total} whole class="card-value" />
              <span class="card-sub">
                {model.dueThisMonth.count} payment{model.dueThisMonth.count === 1 ? '' : 's'} left
              </span>
            </div>
            {model.cashFlow ? (
              <div class="card">
                <span class="card-label">Left after bills</span>
                <Money cents={model.cashFlow.left} whole class={`card-value ${model.cashFlow.left < 0 ? 'neg-text' : ''}`} />
                <span class="card-sub">
                  until payday {formatShortDate(model.cashFlow.payday)} · <Money cents={model.cashFlow.cash} whole /> in checking − <Money cents={model.cashFlow.bills} whole /> bills
                </span>
              </div>
            ) : (
              <button type="button" class="card" onClick={() => add('income')}>
                <span class="card-label">Left after bills</span>
                <span class="card-value muted">—</span>
                <span class="card-sub link">Add your paycheck to see this</span>
              </button>
            )}
          </div>

          <div class="view-switch">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'calendar', label: 'Calendar' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>

          {view === 'upcoming' &&
            (groups.length === 0 ? (
              <Empty icon="check" title="Nothing due soon" />
            ) : (
              groups.map(([title, items]) => (
                <Section title={title}>
                  {items.map((i) => (
                    <RecurringRow status={i.status} today={today} date={i.date} late={i.late} category={cat(i.status.rec.categoryId)} />
                  ))}
                </Section>
              ))
            ))}

          {view === 'calendar' && <BillCalendar statuses={model.statuses} today={today} categories={cats} />}

          {view === 'all' && (
            <>
              {kinds.map((k) => {
                const items = active.filter((s) => s.rec.kind === k);
                if (!items.length) return null;
                const monthly = items.reduce((s, x) => s + monthlyCost(x), 0);
                return (
                  <Section
                    title={
                      <>
                        <span>{KINDS[k].plural}</span>
                        {k !== 'trial' && (
                          <span>
                            <Money cents={monthly} whole />
                            /mo
                          </span>
                        )}
                      </>
                    }
                  >
                    {items.map((s) => (
                      <RecurringRow status={s} today={today} category={cat(s.rec.categoryId)} />
                    ))}
                  </Section>
                );
              })}
              {cancelled.length > 0 && (
                <Section
                  title={
                    <>
                      <span>Cancelled</span>
                      <span>
                        saved <Money cents={totalSaved} whole />
                      </span>
                    </>
                  }
                >
                  {cancelled.map((s) => (
                    <RecurringRow
                      status={s}
                      today={today}
                      category={cat(s.rec.categoryId)}
                      subtitle={`Cancelled ${s.rec.cancelledOn ? formatShortDate(s.rec.cancelledOn) : ''}${s.saved ? ` · saved ${formatMoney(s.saved, { whole: true })}` : ''}`}
                    />
                  ))}
                </Section>
              )}
              <Section>
                <button type="button" class="row link-row" onClick={() => add()}>
                  Add Recurring Item
                </button>
                <button type="button" class="row link-row" onClick={() => add('trial')}>
                  Track a Free Trial
                </button>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
