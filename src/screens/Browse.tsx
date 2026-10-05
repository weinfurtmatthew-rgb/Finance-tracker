import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useAccounts, useBook, useCategories, useMeta, useTransactions } from '../hooks';
import { setMeta } from '../db';
import { useNav } from '../nav';
import { useRecurringModel } from '../recurringModel';
import { useSpending } from '../spendingModel';
import { netWorthOn } from '../lib/networth';
import { budgetProgress, monthSpent } from '../lib/budgets';
import { countsAsCost, monthlyCost } from '../lib/recurring';
import { allTags, owedByPerson, owedItems } from '../lib/lines';
import { people } from '../lib/p2p';
import { monthKey } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Glyph, IconChip, type GlyphName, type Hue } from '../components/icons';
import { ProfileButton } from '../components/ProfileButton';
import { useMoneyHealth } from '../healthModel';
import { nextWin } from '../lib/health';
import { BudgetsEditor } from './BudgetsEditor';
import { CategoryDetail } from './CategoryDetail';
import { CategoryIcon } from '../components/ui';
import type { Category } from '../types';
import { PeopleSheet } from './People';
import { TagsSheet } from './Tags';
import { Plan } from '../lazy';
import { RecapPage, RecapTeaser } from './Recap';

type ItemId = 'spending' | 'bills' | 'budgets' | 'networth' | 'health' | 'people' | 'tags' | 'plan' | 'recap';
type GroupId = 'money' | 'plan' | 'people';

/** Every feature has one home. Setup (categories, rules) lives in Settings; importing lives in Activity. */
const GROUPS: { id: GroupId; title: string }[] = [
  { id: 'money', title: 'Money' },
  { id: 'plan', title: 'Plan & Look Back' },
  { id: 'people', title: 'People & Trips' },
];

/** Browse as a grouped list (compact, numbers on the right) or as big tiles; you pick, it's remembered. */
export type BrowseLayout = 'list' | 'tiles';

interface Item {
  id: ItemId;
  group: GroupId;
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

const DEFAULT_PINS: ItemId[] = ['networth', 'spending', 'health', 'recap'];

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
  const layout = useMeta<BrowseLayout>('browseLayout') ?? 'list';
  const health = useMoneyHealth();
  const [editing, setEditing] = useState(false);
  const today = rec.today;
  const month = monthKey(today);

  const items = useMemo<Item[]>(() => {
    const m = months.get(month);
    const spent = monthSpent(m);
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
      {
        id: 'spending',
        group: 'money',
        title: 'Spending',
        glyph: 'bag',
        hue: 'orange',
        sub: `${whole(spent)} this month`,
        value: whole(spent),
        note: 'this month',
        open: () => nav.setTab('spending'),
      },
      {
        id: 'budgets',
        group: 'money',
        title: 'Budgets',
        glyph: 'target',
        hue: 'yellow',
        sub: progress.length ? `${onTrack} of ${progress.length} on track` : 'Set monthly limits',
        value: progress.length ? `${onTrack} of ${progress.length}` : undefined,
        note: 'on track this month',
        open: present((close) => <BudgetsEditor onClose={close} />),
      },
      {
        id: 'bills',
        group: 'money',
        title: 'Bills & Subscriptions',
        glyph: 'repeat',
        hue: 'violet',
        sub: active.length
          ? `${active.length} active · ${whole(perMonth)} a month`
          : rec.suggestions.length
            ? `${rec.suggestions.length} to review`
            : 'Find what repeats',
        value: active.length ? `${whole(perMonth)}/mo` : undefined,
        note: plural(active.length, 'active item'),
        open: () => nav.setTab('recurring'),
      },
      {
        id: 'networth',
        group: 'money',
        title: 'Net Worth',
        glyph: 'trend',
        hue: 'aqua',
        sub: `${whole(net)} · ${plural(open, 'account')}`,
        value: whole(net),
        note: plural(open, 'account'),
        open: () => nav.setTab('accounts'),
      },
      {
        id: 'health',
        group: 'money',
        title: 'Money Health',
        glyph: 'shield',
        hue: 'green',
        sub: health ? `${health.score} · ${health.band}` : 'Your bigger picture, 0–100',
        value: health ? String(health.score) : undefined,
        note: health ? `${health.band}${nextWin(health) ? ` · next: ${nextWin(health)!.name.toLowerCase()}` : ''}` : undefined,
        open: () => nav.setTab('health'),
      },
      {
        id: 'plan',
        group: 'plan',
        title: 'Plan',
        glyph: 'calc',
        hue: 'yellow',
        sub: 'Rent, debt, savings & more',
        open: present((close) => <Plan onClose={close} />),
      },
      {
        id: 'recap',
        group: 'plan',
        title: 'Year in Review',
        glyph: 'play',
        hue: 'magenta',
        sub: `${today.slice(0, 4)} so far`,
        open: present((close) => <RecapPage onClose={close} />),
      },
      {
        id: 'people',
        group: 'people',
        title: 'People',
        glyph: 'users',
        hue: 'blue',
        sub: owedTotal ? `${whole(owedTotal)} owed to you` : friends ? `${plural(friends, 'person', 'people')} · payment apps` : 'Venmo, Cash App & Apple Cash',
        value: owedTotal ? whole(owedTotal) : undefined,
        note: owedTotal ? `owed to you by ${plural(owed.length, 'person', 'people')}` : undefined,
        open: present((close) => <PeopleSheet onClose={close} />),
      },
      {
        id: 'tags',
        group: 'people',
        title: 'Trips & Tags',
        glyph: 'tag',
        hue: 'violet',
        sub: tags ? plural(tags, 'tag') : 'Tag a trip or event',
        open: present((close) => <TagsSheet onClose={close} />),
      },
    ];
  }, [txns, accounts, categories, rec, months, budgets, book, month, today, health]);

  // Categories pinned from their page ("cat:<id>") show what they've cost this month.
  const categoryItem = (pin: string): Item | undefined => {
    const id = pin.slice(4);
    const c = categories.find((x) => x.id === id);
    if (!c) return undefined;
    const spent = Math.max(0, months.get(month)?.allByCategory.get(id) ?? 0);
    return {
      id: pin as ItemId,
      group: 'money',
      title: c.name,
      glyph: 'tag',
      hue: 'blue',
      category: c,
      sub: 'this month',
      value: whole(spent),
      note: 'this month',
      open: () => nav.present((close) => <CategoryDetail categoryId={id} month={month} onClose={close} />),
    };
  };
  const pinned = pins.map((id) => (id.startsWith('cat:') ? categoryItem(id) : items.find((i) => i.id === id))).filter((i): i is Item => !!i);
  const togglePin = (id: ItemId) => void setMeta('browsePins', pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]);

  return (
    <>
      <header class="large-title">
        <h1>Browse</h1>
        <div class="header-actions">
          <button
            type="button"
            class="icon-button"
            aria-label={layout === 'list' ? 'Show as tiles' : 'Show as a list'}
            onClick={() => void setMeta('browseLayout', layout === 'list' ? 'tiles' : 'list')}
          >
            <Glyph name={layout === 'list' ? 'grid' : 'list'} />
          </button>
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
          {pinned.map((i) =>
            // Year in Review keeps its own card (this year's totals), across the full width.
            i.id === 'recap' && !editing ? (
              <div class="browse-pin-wide">
                <RecapTeaser onOpen={i.open} />
              </div>
            ) : (
              <button type="button" class={`card browse-pin ${i.id === 'health' ? 'shimmer' : ''}`} onClick={editing ? () => togglePin(i.id) : i.open}>
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
            ),
          )}
        </div>
      ) : (
        <p class="section-footer browse-hint">Nothing pinned. Tap Edit, then the cards you check most.</p>
      )}

      {GROUPS.map((g) => {
        const list = items.filter((i) => i.group === g.id);
        return (
          <>
            <h2 class="section-heading browse-all">{g.title}</h2>
            {layout === 'list' ? (
              <div class="group browse-list">
                {list.map((i) => (
                  <button
                    type="button"
                    class={`row browse-row ${editing && pins.includes(i.id) ? 'pinned' : ''}`}
                    aria-pressed={editing ? pins.includes(i.id) : undefined}
                    onClick={editing ? () => togglePin(i.id) : i.open}
                  >
                    <IconChip name={i.glyph} hue={i.hue} size="sm" />
                    <span class="row-main">
                      <span class="row-title browse-card-title">{i.title}</span>
                      {!i.value && <span class="row-subtitle">{i.sub}</span>}
                    </span>
                    {editing ? (
                      <span class="browse-pin-mark" aria-hidden="true">
                        <Glyph name={pins.includes(i.id) ? 'check' : 'plus'} />
                      </span>
                    ) : (
                      <>
                        {i.value && <span class="row-detail num">{i.value}</span>}
                        <span class="chevron" aria-hidden="true">
                          ›
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div class="browse-grid">
                {list.map((i) => (
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
            )}
          </>
        );
      })}
    </>
  );
}
