import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { byId, useAccounts, useCategories, useMeta, useTransactions } from '../hooks';
import { setMeta } from '../db';
import { useNav } from '../nav';
import { useSpending } from '../spendingModel';
import { useAsk, type Reply } from '../askModel';
import { allTags } from '../lib/lines';
import { addRecent, buildSearchIndex, looksLikeQuestion, searchPlaces, searchTransactions, topHit, type PlaceMatch } from '../lib/search';
import { useStore } from '../store';
import { addDays, monthKey, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { placeKey } from '../lib/detail';
import { EXAMPLES } from '../ai/ask';
import { CategoryIcon, Empty, Row, Section } from '../components/ui';
import { Glyph, IconChip, type GlyphName } from '../components/icons';
import { TransactionRow } from '../components/TransactionRow';
import { CategoryDetail } from './CategoryDetail';
import { PlaceDetail } from './PlaceDetail';
import type { Transaction } from '../types';

const MAX_TXNS = 40;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Stores whose name contains the text (any store when it's empty), most visited first. */
function matchingPlaces(txns: Transaction[], q: string, limit = 5): PlaceMatch[] {
  const m = new Map<string, PlaceMatch>();
  for (const t of txns) {
    const key = placeKey(t);
    if (!key || !key.includes(q)) continue;
    const p = m.get(key) ?? { key, name: t.payee || t.description, count: 0 };
    p.count++;
    m.set(key, p);
  }
  return [...m.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * One box at the bottom for everything: categories, stores, tags and transactions as you type, and
 * questions answered right here. `back` returns to the tab you came from.
 */
export function Search(props: { back: { label: string; glyph: GlyphName; go: () => void } }) {
  const nav = useNav();
  const txns = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const { months } = useSpending();
  const cats = useMemo(() => byId(categories), [categories]);
  const accts = useMemo(() => byId(accounts), [accounts]);
  const recents = useMeta<string[]>('recentSearches') ?? [];
  const { ask: askFor, ready } = useAsk();
  const asking = useRef<string>();
  const [query, setQuery] = useState('');
  const [replies, setReplies] = useState<Reply[]>([]);
  const [thinking, setThinking] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // iPhone Safari doesn't move fixed bars when the keyboard opens; lift the search box above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const place = () => root.style.setProperty('--keyboard', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
    vv.addEventListener('resize', place);
    vv.addEventListener('scroll', place);
    return () => {
      vv.removeEventListener('resize', place);
      vv.removeEventListener('scroll', place);
      root.style.removeProperty('--keyboard');
    };
  }, []);
  const today = todayISO();
  const month = monthKey(today);

  const q = query.trim().toLowerCase();
  // Prepared once per change to the data, so typing only scans (see buildSearchIndex).
  const store = useStore();
  const index = store.derive('searchIndex', [txns, cats], () => buildSearchIndex(txns, (id) => cats.get(id)?.name));
  const tagList = store.derive('allTags', [txns], () => allTags(txns));
  const results = useMemo(() => {
    if (!q) return null;
    const visible = categories.filter((c) => !c.hidden);
    const places = searchPlaces(index, q, 20);
    const hit = topHit(q, visible, places);
    return {
      hit,
      hitPlace: hit?.kind === 'place' ? places.find((p) => p.key === hit.key) : undefined,
      categories: visible.filter((c) => c.name.toLowerCase().includes(q) && !(hit?.kind === 'category' && hit.id === c.id)).slice(0, 6),
      places: places.filter((p) => !(hit?.kind === 'place' && hit.key === p.key)).slice(0, 5),
      tags: tagList.filter((t) => t.tag.toLowerCase().includes(q.replace(/^#/, ''))).slice(0, 6),
      // "coffee" also finds Starbucks: transactions in a matching category count too.
      txns: searchTransactions(index, q),
    };
  }, [q, index, tagList, categories]);
  const frequent = useMemo(() => {
    const since = addDays(today, -90);
    return matchingPlaces(
      txns.filter((t) => t.date >= since && t.amount < 0 && cats.get(t.categoryId)?.group === 'expense'),
      '',
      6,
    );
  }, [txns, today, cats]);

  const remember = (text: string) => void setMeta('recentSearches', addRecent(recents, text));
  // A question waits (as "Thinking…") until Ask's data has loaded, so it's never answered from nothing.
  const ask = (question: string) => {
    const text = question.trim();
    if (!text || thinking) return;
    remember(text);
    setQuery('');
    setThinking(text);
    input.current?.blur();
  };
  useEffect(() => {
    if (!thinking || !ready || asking.current === thinking) return;
    asking.current = thinking;
    void askFor(thinking).then((reply) => {
      asking.current = undefined;
      setThinking(undefined);
      setReplies((r) => [reply, ...r].slice(0, 5));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, [thinking, ready]);
  const submit = () => {
    // Read the box itself: return can come before the last keystroke has re-rendered.
    const text = input.current?.value ?? query;
    if (looksLikeQuestion(text)) ask(text);
    else if (text.trim()) {
      remember(text);
      input.current?.blur();
    }
  };
  const openCategory = (id: string) => {
    if (q) remember(query);
    nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />);
  };
  const openPlace = (key: string) => {
    if (q) remember(query);
    nav.present((close) => <PlaceDetail placeKey={key} onClose={close} />);
  };
  const pickRecent = (text: string) => {
    if (looksLikeQuestion(text)) ask(text);
    else setQuery(text);
  };

  const hitCategory = results?.hit?.kind === 'category' ? cats.get(results.hit.id) : undefined;
  const hitPlace = results?.hitPlace;
  const nothing = results && !results.hit && !results.categories.length && !results.places.length && !results.tags.length && !results.txns.length;
  const question = looksLikeQuestion(query);

  return (
    <>
      <header class="large-title">
        <h1>Search</h1>
      </header>

      {thinking && (
        <section class="card answer-card" aria-live="polite">
          <span class="answer-head">
            <IconChip name="spark" hue="blue" size="sm" />
            <span class="answer-q">{thinking}</span>
          </span>
          <span class="answer-detail">Thinking…</span>
        </section>
      )}
      {!q && replies.map((r) => <AnswerCard reply={r} />)}

      {!results ? (
        <>
          {recents.length > 0 && (
            <section class="section">
              <h3 class="section-title">
                <span>Recent</span>
                <button type="button" class="link" onClick={() => void setMeta('recentSearches', [])}>
                  Clear
                </button>
              </h3>
              <div class="group">
                {recents.map((r) => (
                  <Row
                    icon={
                      <span class="recent-icon">
                        <Glyph name={looksLikeQuestion(r) ? 'spark' : 'clock'} />
                      </span>
                    }
                    title={r}
                    chevron={false}
                    onClick={() => pickRecent(r)}
                  />
                ))}
              </div>
            </section>
          )}

          {frequent.length > 0 && (
            <section class="section">
              <h3 class="section-title">Frequent places</h3>
              <div class="search-chips">
                {frequent.map((p) => (
                  <button type="button" class="chip" onClick={() => openPlace(p.key)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section class="section">
            <h3 class="section-title">Ask about your money</h3>
            <div class="group ask-examples">
              {EXAMPLES.slice(0, replies.length || recents.length ? 4 : EXAMPLES.length).map((e) => (
                <Row icon={<IconChip name="spark" hue="blue" size="sm" />} title={e} chevron={false} onClick={() => ask(e)} />
              ))}
            </div>
            <p class="section-footer">Answers are worked out exactly from your data, on this phone.</p>
          </section>

          {!txns.length && !replies.length && (
            <Empty icon="search" title="Search everything">
              <p>Once you import transactions, find any store, category, #tag or amount here.</p>
            </Empty>
          )}
        </>
      ) : (
        <>
          <button type="button" class={`card search-ask ${question ? 'is-question' : ''}`} onClick={() => ask(query)}>
            <IconChip name="spark" hue="blue" />
            <span class="row-main">
              <span class="search-ask-label">{question ? 'Ask · press return' : 'Ask'}</span>
              <span class="row-title">{query.trim()}</span>
            </span>
          </button>

          {(hitCategory || hitPlace) && (
            <section class="section">
              <h3 class="section-title">Top hit</h3>
              <button type="button" class="card top-hit" onClick={() => (hitCategory ? openCategory(hitCategory.id) : openPlace(hitPlace!.key))}>
                {hitCategory ? <CategoryIcon category={hitCategory} size="md" /> : <IconChip name="bag" hue="orange" />}
                <span class="row-main">
                  <span class="top-hit-title">{hitCategory?.name ?? hitPlace!.name}</span>
                  <span class="row-subtitle">
                    {hitCategory
                      ? `Category · ${formatMoney(Math.max(0, months.get(month)?.allByCategory.get(hitCategory.id) ?? 0), { whole: true })} this month`
                      : `Place · ${plural(hitPlace!.count, 'transaction')}`}
                  </span>
                </span>
                <Glyph name="chevronRight" />
              </button>
            </section>
          )}

          {results.categories.length > 0 && (
            <Section title="Categories">
              {results.categories.map((c) => (
                <Row icon={<CategoryIcon category={c} size="sm" />} title={c.name} onClick={() => openCategory(c.id)} />
              ))}
            </Section>
          )}

          {results.places.length > 0 && (
            <Section title="Places">
              {results.places.map((p) => (
                <Row
                  icon={<IconChip name="bag" hue="orange" size="sm" />}
                  title={p.name}
                  subtitle={plural(p.count, 'transaction')}
                  onClick={() => openPlace(p.key)}
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
                  subtitle={plural(t.count, 'transaction')}
                  detail={formatMoney(t.total)}
                  onClick={() => {
                    remember(query);
                    nav.showActivity({ tag: t.tag });
                  }}
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

      <nav class="tabbar-wrap search-mode" aria-label="Search">
        <button type="button" class="tab-search tab-back" aria-label={`Back to ${props.back.label}`} onClick={props.back.go}>
          <Glyph name={props.back.glyph} />
        </button>
        <form
          class="search search-dock"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Glyph name="search" />
          <input
            ref={input}
            type="search"
            enterKeyHint={question ? 'send' : 'search'}
            placeholder="Search or ask a question"
            aria-label="Search or ask"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
          {query && (
            <button
              type="button"
              class="search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <Glyph name="close" />
            </button>
          )}
        </form>
      </nav>
    </>
  );
}

/** An answer, shown at the top of Search. */
function AnswerCard({ reply }: { reply: Reply }) {
  const nav = useNav();
  const a = reply.answer;
  const filter = a?.filter;
  return (
    <section class="card answer-card">
      <span class="answer-head">
        <IconChip name="spark" hue="blue" size="sm" />
        <span class="answer-q">{reply.question}</span>
      </span>
      {reply.error && <p class="answer-detail">{reply.error}</p>}
      {a && (
        <>
          <strong class="answer-headline">{a.headline}</strong>
          {a.detail && <p class="answer-detail">{a.detail}</p>}
          {a.items && (
            <ul class="ask-items">
              {a.items.map((i) => (
                <li>
                  <span>
                    {i.label}
                    {i.note && <span class="muted"> · {i.note}</span>}
                  </span>
                  <span class="num">{formatMoney(i.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <p class="ask-meta">
            Understood as: {a.interpretation}
            {filter && (filter.categoryId || filter.month || filter.tag) && (
              <>
                {' · '}
                <button type="button" class="link" onClick={() => nav.showActivity(filter)}>
                  See transactions
                </button>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
