import { useMemo, useState } from 'preact/hooks';
import { allTags, categoriesOf, tagKey } from '../lib/lines';
import { byId, useAccounts, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { addMonths, formatDay, monthLabel, monthKey, todayISO } from '../lib/dates';
import { matchesQuery } from '../lib/search';
import { CategorySelect, Empty, Money } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { TransactionEditor } from './TransactionEditor';
import { ImportFlow } from '../lazy';
import { Glyph, IconChip, Icons } from '../components/icons';
import { formatMoney } from '../lib/money';
import { SuggestCategories } from './SuggestCategories';
import { useAi } from '../ai/client';
import type { Transaction } from '../types';

const PAGE = 200;

export function Activity() {
  const nav = useNav();
  const txns = useTransactions();
  const accounts = useAccounts();
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const accts = useMemo(() => byId(accounts), [accounts]);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const f = nav.activityFilter;
  const ai = useAi();

  const group = (t: Transaction) => cats.get(t.categoryId)?.group;
  const kindOf = (t: Transaction) => (group(t) === 'income' ? 'income' : group(t) === 'expense' ? 'spending' : undefined);
  const needsReview = (t: Transaction) => t.categoryId === 'uncategorized' || t.categorySource === 'ai';

  // The month card: the month you're filtered to, or this month.
  const shownMonth = f.month ?? monthKey(todayISO());
  const monthStats = useMemo(() => {
    let spent = 0;
    let income = 0;
    let count = 0;
    for (const t of txns) {
      if (monthKey(t.date) !== shownMonth) continue;
      count++;
      if (group(t) === 'expense') spent -= t.amount;
      else if (group(t) === 'income') income += t.amount;
    }
    return { spent, income, count };
  }, [txns, shownMonth, cats]);
  const toReview = useMemo(() => txns.filter(needsReview).length, [txns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter(
      (t) =>
        (!f.accountId || t.accountId === f.accountId) &&
        (!f.categoryId || categoriesOf(t).includes(f.categoryId)) &&
        (!f.month || monthKey(t.date) === f.month) &&
        (!f.tag || !!t.tags?.some((x) => tagKey(x) === tagKey(f.tag!))) &&
        (!f.kind || kindOf(t) === f.kind || (f.kind === 'review' && needsReview(t))) &&
        matchesQuery(t, q),
    );
  }, [txns, f, query, cats]);

  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[] }[] = [];
    for (const t of filtered.slice(0, limit)) {
      const last = out[out.length - 1];
      if (last?.date === t.date) last.items.push(t);
      else out.push({ date: t.date, items: [t] });
    }
    return out;
  }, [filtered, limit]);

  const hasFilter = !!(f.accountId || f.categoryId || f.month || f.tag || f.kind);
  /** A day's total, leaving out transfers between your own accounts. */
  const dayTotal = (items: Transaction[]) => {
    const counted = items.filter((t) => group(t) !== 'transfer');
    return counted.length ? counted.reduce((s, t) => s + t.amount, 0) : null;
  };
  const isCurrentMonth = shownMonth === monthKey(todayISO());
  const tags = useMemo(() => allTags(txns), [txns]);
  const setFilter = (patch: Partial<typeof f>) => nav.setActivityFilter({ ...f, ...patch });

  return (
    <>
      <header class="large-title">
        <h1>Activity</h1>
        <div class="header-actions">
          <button type="button" class="icon-button" aria-label="Import a file" onClick={() => nav.present((close) => <ImportFlow onClose={close} />)}>
            {Icons.import()}
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="Add transaction"
            onClick={() => nav.present((close) => <TransactionEditor accountId={f.accountId} onClose={close} />)}
          >
            {Icons.plus()}
          </button>
        </div>
      </header>

      {txns.length > 0 && (
        <section class="card month-card" aria-label={`${monthLabel(shownMonth)} at a glance`}>
          <div class="month-card-nav">
            <button type="button" class="round-button" aria-label="Previous month" onClick={() => setFilter({ month: addMonths(shownMonth, -1) })}>
              <Glyph name="chevronLeft" />
            </button>
            <strong>{monthLabel(shownMonth)}</strong>
            <button type="button" class="round-button" aria-label="Next month" disabled={isCurrentMonth} onClick={() => setFilter({ month: addMonths(shownMonth, 1) })}>
              <Glyph name="chevronRight" />
            </button>
          </div>
          <div class="month-card-stats">
            <div>
              <span class="month-stat num">{formatMoney(monthStats.spent, { whole: true })}</span>
              <span class="card-sub">spent</span>
            </div>
            <div>
              <span class="month-stat num pos-text">{formatMoney(monthStats.income, { whole: true })}</span>
              <span class="card-sub">came in</span>
            </div>
            <div>
              <span class="month-stat num">{monthStats.count}</span>
              <span class="card-sub">transactions</span>
            </div>
          </div>
          {!f.month && <span class="month-card-note">The list below shows every month. Use the arrows to see one.</span>}
        </section>
      )}

      <div class="toolbar">
        <label class="search">
          {Icons.search()}
          <input type="search" placeholder="Search payee, notes, amount" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </label>
        <div class="filters">
          <div class="quick-filters" role="group" aria-label="Show">
            {(
              [
                [undefined, 'All'],
                ['spending', 'Spending'],
                ['income', 'Income'],
                ['review', toReview ? `Needs review · ${toReview}` : 'Needs review'],
              ] as const
            ).map(([kind, label]) => (
              <button type="button" class={`chip ${f.kind === kind ? 'on' : ''}`} aria-pressed={f.kind === kind} onClick={() => setFilter({ kind })}>
                {label}
              </button>
            ))}
          </div>
          <select class={f.accountId ? 'chip on' : 'chip'} value={f.accountId ?? ''} onChange={(e) => setFilter({ accountId: (e.target as HTMLSelectElement).value || undefined })} aria-label="Filter by account">
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option value={a.id}>{a.name}</option>
            ))}
          </select>
          <CategorySelect
            class={f.categoryId ? 'chip on' : 'chip'}
            aria-label="Filter by category"
            allowNew={false}
            categories={[{ id: '', name: 'All categories', emoji: '', color: '', group: 'expense', order: -1 }, ...categories]}
            value={f.categoryId ?? ''}
            onChange={(id) => setFilter({ categoryId: id || undefined })}
          />
          {tags.length > 0 && (
            <select class={f.tag ? 'chip on' : 'chip'} value={f.tag ?? ''} aria-label="Filter by tag" onChange={(e) => setFilter({ tag: (e.target as HTMLSelectElement).value || undefined })}>
              <option value="">All tags</option>
              {tags.map((t) => (
                <option value={t.tag}>#{t.tag}</option>
              ))}
            </select>
          )}
          {f.month && (
            <button type="button" class="chip on" onClick={() => setFilter({ month: undefined })}>
              {monthLabel(f.month, { short: true })} ✕
            </button>
          )}
          {hasFilter && (
            <button type="button" class="chip link" onClick={() => nav.setActivityFilter({})}>
              Clear
            </button>
          )}
        </div>
        {f.categoryId === 'uncategorized' && filtered.length > 0 && ai.embed && (
          <button type="button" class="pill suggest-pill" onClick={() => nav.present((close) => <SuggestCategories onClose={close} />)}>
            ✨ Suggest categories for these
          </button>
        )}
        {(hasFilter || query) && filtered.length > 0 && (
          <p class="filter-summary">
            {filtered.length} transaction{filtered.length === 1 ? '' : 's'} · net <Money cents={total} colored />
          </p>
        )}
      </div>

      {toReview > 0 && !hasFilter && !query && (
        <button type="button" class="card review-card" onClick={() => setFilter({ kind: 'review' })}>
          <IconChip name="info" hue="blue" size="sm" />
          <span class="row-main">
            <span class="review-card-title">
              {toReview} transaction{toReview === 1 ? ' needs' : 's need'} a look
            </span>
            <span class="card-sub">No category yet, or one the AI guessed</span>
          </span>
          <span class="pill primary">Review</span>
        </button>
      )}

      {txns.length === 0 ? (
        <Empty icon="receipt" title="No transactions yet">
          <p>Import a CSV or OFX file from your bank, or add one by hand with the + button.</p>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="search" title="Nothing matches" />
      ) : (
        <>
          {groups.map((g) => (
            <section class="section">
              <h3 class="section-title">
                <span>{formatDay(g.date)}</span>
                {dayTotal(g.items) != null && <Money cents={dayTotal(g.items)!} colored class="day-total" />}
              </h3>
              <div class="group">
                {g.items.map((t) => (
                  <TransactionRow txn={t} category={cats.get(t.categoryId)} account={f.accountId ? undefined : accts.get(t.accountId)} />
                ))}
              </div>
            </section>
          ))}
          {filtered.length > limit && (
            <button type="button" class="button wide" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({filtered.length - limit} remaining)
            </button>
          )}
        </>
      )}
    </>
  );
}
