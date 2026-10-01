import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useAccounts, useBook, useCategories, useMeta, useTransactions } from '../hooks';
import { setMeta } from '../db';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { netWorthOn } from '../lib/networth';
import { budgetProgress } from '../lib/budgets';
import { countsAsCost, monthlyCost } from '../lib/recurring';
import { allTags, owedByPerson, owedItems } from '../lib/lines';
import { people } from '../lib/p2p';
import { monthKey } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Glyph, IconChip, type GlyphName, type Hue } from '../components/icons';
import { ProfileButton } from '../components/ProfileButton';
import { useMoneyHealth } from '../healthModel';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';
import { CategoryIcon } from '../components/ui';
import type { Category } from '../types';
import { CategoriesSheet } from './Categories';
import { PeopleSheet } from './People';
import { OwedSheet } from './Owed';
import { TagsSheet } from './Tags';
import { Plan } from './plan/Plan';
import { RecapPage } from './Recap';
import { ImportFlow } from './Import';

type ItemId = 'spending' | 'bills' | 'budgets' | 'networth' | 'health' | 'categories' | 'people' | 'owed' | 'tags' | 'plan' | 'recap' | 'import';

interface Item {
  id: ItemId;
  title: string;
  glyph: GlyphName;
  hue: Exclude<Hue, 'gray'>;
  /** One line about it right now. */
  sub: string;
  /** A category pinned from its page shows its own icon. */
  category?: Category;
  /** The headline number when it's pinned, and a few words under it. */
  value?: string;
  note?: string;
  open: () => void;
}

const DEFAULT_PINS: ItemId[] = ['networth', 'bills'];

const whole = (cents: number) => formatMoney(cents, { whole: true });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Everything in the app, as a grid of cards; the ones you pin come first with their number. */
export function Browse() {
  const nav = useNav();
  const txns = useTransactions();
  const accounts = useAccounts();
  const categories = useCategories();
  const rec = useRecurringModel();
  const { months, budgets } = useSpending();
  const book = useBook();
  const pins = useMeta<ItemId[]>('browsePins') ?? DEFAULT_PINS;
  const health = useMoneyHealth();
  const [editing, setEditing] = useState(false);
  const today = rec.today;
  const month = monthKey(today);

  const items = useMemo<Item[]>(() => {
    const m = months.get(month);
    const spent = (m?.flexible ?? 0) + (m?.fixed ?? 0);
    const active = rec.statuses.filter((s) => s.rec.status === 'active');
    const bills = active.filter((s) => countsAsCost(s.rec));
    const perMonth = bills.reduce((sum, s) => sum + monthlyCost(s), 0);
    const progress = budgetProgress(budgets, m, month, today);
    const onTrack = progress.filter((p) => p.state === 'ok' && !p.offPace).length;
    const net = netWorthOn(book).net;
    const open = accounts.filter((a) => !a.archived).length;
    const owed = owedByPerson(owedItems(txns));
    const owedTotal = owed.reduce((s, p) => s + p.total, 0);
    const friends = people(txns).length;
    const tags = allTags(txns).length;
    const present = (render: (close: () => void) => ComponentChildren) => () => nav.present(render);
    return [
      { id: 'spending', title: 'Spending', glyph: 'bag', hue: 'orange', sub: `${whole(spent)} this month`, value: whole(spent), note: 'this month', open: () => nav.setTab('spending') },
      {
        id: 'bills',
        title: 'Bills & Subscriptions',
        glyph: 'repeat',
        hue: 'violet',
        sub: active.length ? `${active.length} active · ${whole(perMonth)} a month` : 'Find what repeats',
        value: active.length ? `${whole(perMonth)}/mo` : undefined,
        note: plural(active.length, 'active item'),
        open: () => nav.setTab('recurring'),
      },
      {
        id: 'budgets',
        title: 'Budgets',
        glyph: 'target',
        hue: 'yellow',
        sub: progress.length ? `${onTrack} of ${progress.length} on track` : 'Set monthly limits',
        value: progress.length ? `${onTrack} of ${progress.length}` : undefined,
        note: 'on track this month',
        open: present((close) => <BudgetsEditor onClose={close} />),
      },
      {
        id: 'health',
        title: 'Money Health',
        glyph: 'shield',
        hue: 'green',
        sub: health ? `${health.score} · ${health.band}` : 'Your bigger picture, 0–100',
        value: health ? String(health.score) : undefined,
        note: health?.band,
        open: () => nav.setTab('health'),
      },
      { id: 'networth', title: 'Net Worth', glyph: 'trend', hue: 'aqua', sub: `${whole(net)} · ${plural(open, 'account')}`, value: whole(net), note: plural(open, 'account'), open: () => nav.setTab('accounts') },
      { id: 'categories', title: 'Categories', glyph: 'grid', hue: 'blue', sub: plural(categories.filter((c) => !c.hidden).length, 'category', 'categories'), open: present((close) => <CategoriesSheet onClose={close} />) },
      { id: 'people', title: 'People', glyph: 'users', hue: 'blue', sub: friends ? `${plural(friends, 'person', 'people')} · payment apps` : 'Venmo, Cash App & Apple Cash', open: present((close) => <PeopleSheet onClose={close} />) },
      {
        id: 'owed',
        title: 'Owed to You',
        glyph: 'swap',
        hue: 'red',
        sub: owedTotal ? `${whole(owedTotal)} from ${plural(owed.length, 'person', 'people')}` : 'Nobody owes you',
        value: owedTotal ? whole(owedTotal) : undefined,
        note: `from ${plural(owed.length, 'person', 'people')}`,
        open: present((close) => <OwedSheet onClose={close} />),
      },
      { id: 'tags', title: 'Trips & Tags', glyph: 'tag', hue: 'violet', sub: tags ? plural(tags, 'tag') : 'Tag a trip or event', open: present((close) => <TagsSheet onClose={close} />) },
      { id: 'plan', title: 'Plan', glyph: 'calc', hue: 'yellow', sub: 'Rent, debt, savings & more', open: present((close) => <Plan onClose={close} />) },
      { id: 'recap', title: 'Year in Review', glyph: 'play', hue: 'magenta', sub: `${today.slice(0, 4)} so far`, open: present((close) => <RecapPage onClose={close} />) },
      { id: 'import', title: 'Import', glyph: 'upload', hue: 'blue', sub: 'Bank files & statements', open: present((close) => <ImportFlow onClose={close} />) },
    ];
  }, [txns, accounts, categories, rec, months, budgets, book, month, today, health]);

  // Categories pinned from their page ("cat:<id>") show what they've cost this month.
  const categoryItem = (pin: string): Item | undefined => {
    const id = pin.slice(4);
    const c = categories.find((x) => x.id === id);
    if (!c) return undefined;
    const spent = Math.max(0, months.get(month)?.allByCategory.get(id) ?? 0);
    return { id: pin as ItemId, title: c.name, glyph: 'tag', hue: 'blue', category: c, sub: 'this month', value: whole(spent), note: 'this month', open: () => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />) };
  };
  const pinned = pins.map((id) => (id.startsWith('cat:') ? categoryItem(id) : items.find((i) => i.id === id))).filter((i): i is Item => !!i);
  const togglePin = (id: ItemId) => void setMeta('browsePins', pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);

  return (
    <>
      <header class="large-title">
        <h1>Browse</h1>
        <div class="header-actions">
          <ProfileButton />
        </div>
      </header>

      <div class="browse-head">
        <h2 class="section-heading">
          <Glyph name="pin" /> Pinned
        </h2>
        <button type="button" class="link strong" onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing && <p class="section-footer browse-hint">Tap a card to pin or unpin it.</p>}
      {pinned.length > 0 ? (
        <div class="browse-grid">
          {pinned.map((i) => (
            <button type="button" class="card browse-pin" onClick={editing ? () => togglePin(i.id) : i.open}>
              <span class="browse-pin-top">
                {i.category ? <CategoryIcon category={i.category} size="sm" /> : <IconChip name={i.glyph} hue={i.hue} size="sm" />}
                <span class="browse-pin-title">{i.title}</span>
              </span>
              {i.value ? (
                <>
                  <span class="browse-pin-value num">{i.value}</span>
                  <span class="card-sub">{i.note ?? i.sub}</span>
                </>
              ) : (
                <span class="browse-pin-empty">{i.sub}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p class="section-footer browse-hint">Nothing pinned. Tap Edit, then the cards you check most.</p>
      )}

      <h2 class="section-heading browse-all">Everything</h2>
      <div class="browse-grid">
        {items.map((i) => (
          <button
            type="button"
            class={`card browse-card ${editing && pins.includes(i.id) ? 'pinned' : ''}`}
            style={{ '--lit': `color-mix(in oklab, var(--hue-${i.hue}) 30%, transparent)` }}
            aria-pressed={editing ? pins.includes(i.id) : undefined}
            onClick={editing ? () => togglePin(i.id) : i.open}
          >
            <IconChip name={i.glyph} hue={i.hue} />
            {editing && (
              <span class="browse-pin-mark" aria-hidden="true">
                <Glyph name={pins.includes(i.id) ? 'check' : 'plus'} />
              </span>
            )}
            <span class="browse-card-text">
              <span class="browse-card-title">{i.title}</span>
              <span class="browse-card-sub">{i.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
