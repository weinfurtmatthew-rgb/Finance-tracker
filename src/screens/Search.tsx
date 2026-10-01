import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { byId, useAccounts, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { allTags } from '../lib/lines';
import { matchesQuery } from '../lib/search';
import { monthKey, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { CategoryIcon, Empty, Row, Section } from '../components/ui';
import { Glyph, IconChip } from '../components/icons';
import { TransactionRow } from '../components/TransactionRow';
import { CategoryDetail } from './CategoryDetail';
import { AskSheet } from './AskSheet';

const MAX_TXNS = 40;

/** One box for everything: categories, tags and transactions, and a question for Ask. */
export function Search() {
  const nav = useNav();
  const txns = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const cats = useMemo(() => byId(categories), [categories]);
  const accts = useMemo(() => byId(accounts), [accounts]);
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    return {
      categories: categories.filter((c) => !c.hidden && c.name.toLowerCase().includes(q)).slice(0, 6),
      tags: allTags(txns)
        .filter((t) => t.tag.toLowerCase().includes(q.replace(/^#/, '')))
        .slice(0, 6),
      // "coffee" also finds Starbucks: transactions in a matching category count too.
      txns: txns.filter((t) => matchesQuery(t, q) || !!cats.get(t.categoryId)?.name.toLowerCase().includes(q)),
    };
  }, [q, txns, categories, cats]);

  const ask = () => nav.present((close) => <AskSheet question={query.trim()} onClose={close} />);
  const nothing = results && !results.categories.length && !results.tags.length && !results.txns.length;

  return (
    <>
      <header class="large-title">
        <h1>Search</h1>
      </header>
      <label class="search search-big">
        <Glyph name="search" />
        <input
          ref={input}
          type="search"
          placeholder="Places, categories, tags, amounts"
          aria-label="Search transactions, categories and tags"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
      </label>

      {!results ? (
        <Empty icon="search" title="Search everything">
          <p>Find a store, a category, a #tag or an amount. Or ask a question, like “How much did I spend on dining last month?”</p>
        </Empty>
      ) : (
        <>
          <button type="button" class="card search-ask" onClick={ask}>
            <IconChip name="spark" hue="blue" />
            <span class="row-main">
              <span class="search-ask-label">Ask</span>
              <span class="row-title">{query.trim()}</span>
            </span>
          </button>

          {results.categories.length > 0 && (
            <Section title="Categories">
              {results.categories.map((c) => (
                <Row
                  icon={<CategoryIcon category={c} size="sm" />}
                  title={c.name}
                  onClick={() => nav.present((close) => <CategoryDetail categoryId={c.id} month={monthKey(todayISO())} onClose={close} />)}
                />
              ))}
            </Section>
          )}

          {results.tags.length > 0 && (
            <Section title="Tags">
              {results.tags.map((t) => (
                <Row
                  icon={<IconChip name="tag" hue="violet" size="sm" />}
                  title={`#${t.tag}`}
                  subtitle={`${t.count} transaction${t.count === 1 ? '' : 's'}`}
                  detail={formatMoney(t.total)}
                  onClick={() => nav.showActivity({ tag: t.tag })}
                />
              ))}
            </Section>
          )}

          {results.txns.length > 0 && (
            <Section
              title={`Transactions · ${results.txns.length}`}
              footer={results.txns.length > MAX_TXNS ? `Showing the latest ${MAX_TXNS}. Refine your search to see others.` : undefined}
            >
              {results.txns.slice(0, MAX_TXNS).map((t) => (
                <TransactionRow txn={t} category={cats.get(t.categoryId)} account={accts.get(t.accountId)} />
              ))}
            </Section>
          )}

          {nothing && <p class="section-footer center">No matches for “{query.trim()}”.</p>}
        </>
      )}
    </>
  );
}
