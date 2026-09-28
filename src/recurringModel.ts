import { useMemo } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { byId, useAccounts, useCategories, useMeta, useTransactions } from './hooks';
import type { AmountMode, Cents, ISODate, Recurring } from './types';
import { addDays, dayInMonth, todayISO } from './lib/dates';
import { accountBalance } from './lib/balances';
import {
  DEFAULT_SETTINGS, countsAsCost, detectRecurring, isOutflow, monthlyCost, nextOnSchedule, recurringStatus, upcoming,
  type PriceAlertRule, type RecurringSettings, type RecurringStatus, type Suggestion, type UpcomingItem,
} from './lib/recurring';

export interface Alert {
  key: string;
  status: RecurringStatus;
  type: 'price' | 'after-cancel' | 'trial-ending' | 'trial-ended';
}

export interface CashFlow {
  payday: ISODate;
  cash: Cents;
  bills: Cents;
  left: Cents;
  items: UpcomingItem[];
}

export interface RecurringModel {
  loaded: boolean;
  today: ISODate;
  settings: RecurringSettings;
  recurring: Recurring[];
  statuses: RecurringStatus[];
  suggestions: Suggestion[];
  alerts: Alert[];
  /** Unpaid due dates through the end of next month, including overdue ones. */
  upcomingItems: UpcomingItem[];
  monthly: Cents;
  monthlySubscriptions: Cents;
  dueThisMonth: { total: Cents; count: number };
  cashFlow?: CashFlow;
}

const EMPTY: never[] = [];

export function useRecurringModel(): RecurringModel {
  const txns = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const recurring = useLiveQuery(() => db.recurring.orderBy('id').toArray(), []);
  const amountMode = useMeta<AmountMode>('recurringAmountMode');
  const priceAlert = useMeta<PriceAlertRule>('priceAlert');
  const reminderDays = useMeta<number>('reminderDays');
  const dismissed = useMeta<string[]>('dismissedRecurring');
  const dismissedAlerts = useMeta<string[]>('dismissedAlerts');
  const today = todayISO();

  const settings: RecurringSettings = useMemo(
    () => ({
      amountMode: amountMode ?? DEFAULT_SETTINGS.amountMode,
      priceAlert: priceAlert ?? DEFAULT_SETTINGS.priceAlert,
      reminderDays: reminderDays ?? DEFAULT_SETTINGS.reminderDays,
    }),
    [amountMode, priceAlert, reminderDays],
  );

  const recs = recurring ?? EMPTY;
  const statuses = useMemo(() => recs.map((r) => recurringStatus(r, txns, today, settings)), [recs, txns, today, settings]);
  const cats = useMemo(() => byId(categories), [categories]);
  const suggestions = useMemo(
    () => (recurring ? detectRecurring(txns, cats, recs, new Set(dismissed ?? [])) : []),
    [txns, cats, recs, recurring, dismissed],
  );

  return useMemo(() => {
    const hidden = new Set(dismissedAlerts ?? []);
    const alerts: Alert[] = [];
    for (const s of statuses) {
      const r = s.rec;
      if (s.priceChange) alerts.push({ key: `price:${r.id}:${s.priceChange.txnId}`, status: s, type: 'price' });
      if (s.chargedAfterCancel) alerts.push({ key: `after-cancel:${r.id}:${s.chargedAfterCancel.id}`, status: s, type: 'after-cancel' });
      if (r.kind === 'trial' && r.status === 'active' && r.trialEndsOn) {
        if (s.trialEnded) alerts.push({ key: `trial-ended:${r.id}`, status: s, type: 'trial-ended' });
        else if (r.trialEndsOn <= addDays(today, settings.reminderDays)) alerts.push({ key: `trial-ending:${r.id}:${r.trialEndsOn}`, status: s, type: 'trial-ending' });
      }
    }
    const visibleAlerts = alerts.filter((a) => a.type === 'trial-ended' || !hidden.has(a.key));

    const active = statuses.filter((s) => s.rec.status === 'active');
    const endOfNextMonth = dayInMonth(today, 1, 31);
    const upcomingItems = upcoming(active, today, endOfNextMonth);
    const monthly = active.filter((s) => countsAsCost(s.rec)).reduce((sum, s) => sum + monthlyCost(s), 0);
    const monthlySubscriptions = active.filter((s) => s.rec.kind === 'subscription').reduce((sum, s) => sum + monthlyCost(s), 0);

    const endOfMonth = dayInMonth(today, 0, 31);
    const dueItems = upcomingItems.filter((i) => isOutflow(i.status.rec) && i.date <= endOfMonth);
    const dueThisMonth = { total: dueItems.reduce((s, i) => s + Math.abs(i.amount), 0), count: dueItems.length };

    // "Left after bills": cash in checking now, minus what's due before the next paycheck.
    let cashFlow: CashFlow | undefined;
    const paydays = active
      .filter((s) => s.rec.kind === 'income')
      .map((s) => {
        let d = s.nextDue;
        while (d < today) d = nextOnSchedule(d, s.rec);
        return d;
      })
      .sort();
    if (paydays.length) {
      const payday = paydays[0];
      const items = upcomingItems.filter((i) => isOutflow(i.status.rec) && i.date < payday);
      const bills = items.reduce((s, i) => s + Math.abs(i.amount), 0);
      const cash = accounts
        .filter((a) => !a.archived && (a.type === 'checking' || a.type === 'cash'))
        .reduce((s, a) => s + accountBalance(a, txns), 0);
      cashFlow = { payday, cash, bills, left: cash - bills, items };
    }

    return {
      loaded: !!recurring,
      today,
      settings,
      recurring: recs,
      statuses,
      suggestions,
      alerts: visibleAlerts,
      upcomingItems,
      monthly,
      monthlySubscriptions,
      dueThisMonth,
      cashFlow,
    };
  }, [statuses, suggestions, dismissedAlerts, today, settings, accounts, txns, recs, recurring]);
}
