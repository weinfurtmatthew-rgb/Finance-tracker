/**
 * The recap as a list of cards (story slides and the recap page share them). Each card appears only
 * when its data does.
 */
import type { Category } from '../types';
import type { Recap } from './recap';
import { formatMoney } from './money';
import { formatDay, monthLabel } from './dates';

export interface RecapCard {
  key: string;
  emoji: string;
  kicker: string;
  big: string;
  sub?: string;
  lines?: string[];
  /** Background theme for the story slide. */
  theme: 'blue' | 'orange' | 'green' | 'purple' | 'pink' | 'teal' | 'indigo' | 'gold';
}

const money = (c: number) => formatMoney(c, { whole: true });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const month = (m: string) => monthLabel(m).split(' ')[0];

/** A fun comparison for your habit: "that's about 190 burritos". */
function habitComparison(name: string, visits: number): string | undefined {
  const n = name.toLowerCase();
  if (/chipotle|taco|burrito/.test(n)) return `That's about ${plural(visits, 'burrito bowl')}.`;
  if (/starbucks|dunkin|coffee|peet|cafe/.test(n)) return `That's about ${plural(visits, 'coffee')} (${Math.round(visits / 52)} a week).`;
  if (/pizza|domino/.test(n)) return `That's about ${plural(visits, 'pizza')}.`;
  if (/uber|lyft/.test(n)) return `That's ${plural(visits, 'ride')}.`;
  return undefined;
}

export function recapCards(r: Recap, cats: Map<string, Category>): RecapCard[] {
  const cards: RecapCard[] = [];
  const when = r.period.phrase;
  const catName = (id: string) => cats.get(id)?.name ?? 'Other';
  const catEmoji = (id: string) => cats.get(id)?.emoji ?? '📦';

  cards.push({
    key: 'intro',
    emoji: '✨',
    kicker: r.period.label,
    big: `${money(r.spent)} spent`,
    sub: r.earned > 0 ? `${money(r.earned)} earned · ${r.saved >= 0 ? `${money(r.saved)} saved` : `${money(-r.saved)} more out than in`}` : undefined,
    theme: 'blue',
  });

  if (r.topCategories.length) {
    const [first] = r.topCategories;
    cards.push({
      key: 'categories',
      emoji: catEmoji(first.id),
      kicker: 'Where it went',
      big: catName(first.id),
      sub: `${money(first.value)} · ${pct(first.share)} of your spending`,
      lines: r.topCategories.slice(1, 5).map((c, i) => `${i + 2}. ${catEmoji(c.id)} ${c.label} · ${money(c.value)}`),
      theme: 'orange',
    });
  }

  if (r.habit) {
    cards.push({
      key: 'habit',
      emoji: '📍',
      kicker: 'Your #1 spot',
      big: r.habit.name,
      sub: `${plural(r.habit.visits, 'visit')} ${when} · ${money(r.habit.total)}`,
      lines: [
        `About once every ${plural(r.habit.everyDays, 'day')}, ${money(r.habit.average)} a visit.`,
        habitComparison(r.habit.name, r.habit.visits) ?? '',
      ].filter(Boolean),
      theme: 'pink',
    });
  }

  if (r.topMerchants.length >= 3) {
    cards.push({
      key: 'merchants',
      emoji: '🏪',
      kicker: 'Top places',
      big: r.topMerchants[0].label,
      sub: money(r.topMerchants[0].value),
      lines: r.topMerchants.slice(1, 5).map((m, i) => `${i + 2}. ${m.label} · ${money(m.value)}${m.visits ? ` · ${plural(m.visits, 'visit')}` : ''}`),
      theme: 'purple',
    });
  }

  if (r.biggest || r.priciestMonth) {
    cards.push({
      key: 'moments',
      emoji: '🎯',
      kicker: 'Big moments',
      big: r.biggest ? money(r.biggest.amount) : month(r.priciestMonth!.month),
      sub: r.biggest ? `Your biggest purchase: ${r.biggest.payee}, ${formatDay(r.biggest.date)}` : undefined,
      lines: [
        r.priciestMonth ? `Priciest month: ${month(r.priciestMonth.month)} (${money(r.priciestMonth.spent)})` : '',
        r.cheapestMonth ? `Lightest month: ${month(r.cheapestMonth.month)} (${money(r.cheapestMonth.spent)})` : '',
      ].filter(Boolean),
      theme: 'indigo',
    });
  }

  if (r.noSpend && r.noSpend.days > 0) {
    cards.push({
      key: 'nospend',
      emoji: '🧘',
      kicker: 'No-spend days',
      big: plural(r.noSpend.days, 'day'),
      sub: 'without any everyday spending (bills aside)',
      lines: r.noSpend.longest >= 2 ? [`Longest streak: ${plural(r.noSpend.longest, 'day')}${r.noSpend.longestFrom ? `, starting ${formatDay(r.noSpend.longestFrom)}` : ''}.`] : [],
      theme: 'teal',
    });
  }

  if (r.weekdays) {
    const more = r.weekdays.weekendDaily > r.weekdays.weekdayDaily;
    cards.push({
      key: 'weekdays',
      emoji: '📅',
      kicker: 'When you spend',
      big: `${r.weekdays.busiest}s`,
      sub: `your biggest spending day (${pct(r.weekdays.busiestShare)} of everyday spending)`,
      lines: [`A weekend day averages ${money(r.weekdays.weekendDaily)}; a weekday ${money(r.weekdays.weekdayDaily)}. ${more ? 'Weekends win.' : 'Weekdays win.'}`],
      theme: 'gold',
    });
  }

  if (r.subscriptions) {
    const s = r.subscriptions;
    cards.push({
      key: 'subscriptions',
      emoji: '🔁',
      kicker: 'Subscriptions',
      big: money(s.total),
      sub: `on ${plural(s.count, 'subscription')} ${when}`,
      lines: [
        s.added.length ? `New: ${s.added.slice(0, 3).join(', ')}` : '',
        ...s.cancelled.slice(0, 3).map((c) => `Cancelled ${c.name}${c.saved > 0 ? `, saving ${money(c.saved)} so far` : ''} 👏`),
      ].filter(Boolean),
      theme: 'purple',
    });
  }

  if (r.netWorth || r.savingsRate != null) {
    cards.push({
      key: 'savings',
      emoji: r.saved >= 0 ? '📈' : '📉',
      kicker: 'Saving & net worth',
      big: r.savingsRate != null ? `${pct(Math.max(-1, r.savingsRate))} saved` : money(r.netWorth!.end),
      sub: r.netWorth
        ? r.netWorth.known
          ? `Net worth ${r.netWorth.change >= 0 ? 'up' : 'down'} ${money(Math.abs(r.netWorth.change))}, to ${money(r.netWorth.end)}`
          : `Net worth now: ${money(r.netWorth.end)}`
        : undefined,
      lines: [
        ...r.goalsReached.map((g) => `Goal reached: ${g} 🎉`),
        r.emergencyMonths != null ? `Your cash covers ${r.emergencyMonths.toFixed(1)} months of spending.` : '',
      ].filter(Boolean),
      theme: 'green',
    });
  }

  if ((r.debt && r.debt.paidDown !== 0) || r.feesPaid > 0) {
    cards.push({
      key: 'debt',
      emoji: '💳',
      kicker: 'Debt & fees',
      big: r.debt && r.debt.paidDown > 0 ? `${money(r.debt.paidDown)} paid down` : r.debt ? `${money(-r.debt.paidDown)} more owed` : `${money(r.feesPaid)} in fees`,
      sub: r.debt ? `You owe ${money(r.debt.end)} now, from ${money(r.debt.start)}.` : undefined,
      lines: r.feesPaid > 0 && r.debt ? [`Interest & fees paid to banks: ${money(r.feesPaid)}.`] : [],
      theme: 'indigo',
    });
  }

  if (r.vsLastYear) {
    const v = r.vsLastYear;
    const diff = r.spent - v.spentBefore;
    cards.push({
      key: 'vs',
      emoji: diff > 0 ? '⬆️' : '⬇️',
      kicker: 'Vs the year before',
      big: `${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))}`,
      sub: `${money(r.spent)} vs ${money(v.spentBefore)} over the same dates`,
      lines: [
        ...v.up.slice(0, 2).map((c) => `More on ${catEmoji(c.id)} ${c.label}: +${money(c.value)}`),
        ...v.down.slice(0, 2).map((c) => `Less on ${catEmoji(c.id)} ${c.label}: −${money(-c.value)}`),
      ],
      theme: 'orange',
    });
  }

  if (r.trips.length) {
    cards.push({
      key: 'trips',
      emoji: '🧳',
      kicker: 'Trips & events',
      big: `#${r.trips[0].tag}`,
      sub: `${money(r.trips[0].total)} · ${formatDay(r.trips[0].from)}${r.trips[0].to !== r.trips[0].from ? ` – ${formatDay(r.trips[0].to)}` : ''}`,
      lines: r.trips.slice(1, 4).map((t) => `#${t.tag} · ${money(t.total)}`),
      theme: 'teal',
    });
  }

  if (r.budgets && r.budgets.monthsTracked > 0) {
    cards.push({
      key: 'budgets',
      emoji: r.budgets.monthsUnder === r.budgets.monthsTracked ? '🏆' : '📊',
      kicker: 'Budgets',
      big: `${r.budgets.monthsUnder} of ${r.budgets.monthsTracked}`,
      sub: 'full months within your budget',
      theme: 'green',
    });
  }

  if (r.income && r.income.paychecks > 0) {
    cards.push({
      key: 'income',
      emoji: '💵',
      kicker: 'Income',
      big: money(r.income.total),
      sub: r.income.mainPayer ? `${plural(r.income.paychecks, 'paycheck')} from ${r.income.mainPayer}` : undefined,
      lines: r.income.raise ? [`Your paycheck went up ${pct(r.income.raise.pct)}: ${money(r.income.raise.from)} → ${money(r.income.raise.to)}. 🎉`] : [],
      theme: 'gold',
    });
  }

  if (r.style) {
    cards.push({ key: 'style', emoji: r.style.emoji, kicker: 'Your spending style', big: r.style.name, sub: r.style.why, theme: 'pink' });
  }

  cards.push({
    key: 'outro',
    emoji: '🎬',
    kicker: `That was ${r.period.label}`,
    big: r.saved >= 0 ? `${money(r.saved)} saved` : `${money(r.spent)} spent`,
    sub: [r.style ? `${r.style.emoji} ${r.style.name}` : '', r.topCategories[0] ? `Top: ${catName(r.topCategories[0].id)}` : '', r.habit ? `#1 spot: ${r.habit.name}` : '']
      .filter(Boolean)
      .join(' · '),
    theme: 'blue',
  });
  return cards;
}
