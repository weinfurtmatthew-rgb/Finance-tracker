import { useMemo, useState } from 'preact/hooks';
import { allTags, categoriesOf, tagKey } from '../lib/lines';
import { byId, useAccounts, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { formatDay, monthLabel, monthKey } from '../lib/dates';
import { CategorySelect, Empty, Money } from '../components/ui';
import { TransactionRow } from '../components/TransactionRow';
import { TransactionEditor } from './TransactionEditor';
import { ImportFlow } from './Import';
import { Icons } from '../components/icons';
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter(
      (t) =>
        (!f.accountId || t.accountId === f.accountId) &&
        (!f.categoryId || categoriesOf(t).includes(f.categoryId)) &&
        (!f.month || monthKey(t.date) === f.month) &&
        (!f.tag || !!t.tags?.some((x) => tagKey(x) === tagKey(f.tag!))) &&
        (!q ||
          !!t.tags?.some((x) => tagKey(x).includes(q.replace(/^#/, ''))) ||
          t.payee.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          (t.amount / 100).toFixed(2).includes(q.replace(/[$,-]/g, ''))),
    );
  }, [txns, f, query]);

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

  const hasFilter = !!(f.accountId || f.categoryId || f.month || f.tag);
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
      <div class="toolbar">
        <label class="search">
          {Icons.search()}
          <input type="search" placeholder="Search payee, notes, amount" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
        </label>
        <div class="filters">
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

      {txns.length === 0 ? (
        <Empty icon="🧾" title="No transactions yet">
          <p>Import a CSV or OFX file from your bank, or add one by hand with the + button.</p>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty icon="🔍" title="Nothing matches" />
      ) : (
        <>
          {groups.map((g) => (
            <section class="section">
              <h3 class="section-title">{formatDay(g.date)}</h3>
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
