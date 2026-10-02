import { useMemo } from 'preact/hooks';
import { CountUp } from '../components/motion';
import { byId, useAccounts, useCategories, useTransactions } from '../hooks';
import { useNav } from '../nav';
import { formatShortDate, monthKey, monthLabel, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { lastMonths, placeMonths, placeStats } from '../lib/detail';
import { ColumnChart } from '../components/charts';
import { CategoryIcon, Empty, Sheet } from '../components/ui';
import { categoryLook } from '../components/look';
import { TransactionRow } from '../components/TransactionRow';
import { categoryHue } from './CategoryDetail';

const whole = (c: number) => formatMoney(c, { whole: true });

/** A store up close: how often you go, what you spend there, and every visit. */
export function PlaceDetail(props: { placeKey: string; onClose: () => void }) {
  const nav = useNav();
  const txns = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const cats = useMemo(() => byId(categories), [categories]);
  const accts = useMemo(() => byId(accounts), [accounts]);
  const today = todayISO();
  const s = useMemo(() => placeStats(txns, props.placeKey, today), [txns, props.placeKey, today]);
  if (!s) {
    return (
      <Sheet title="Place" onClose={props.onClose}>
        <Empty icon="search" title="Nothing here anymore" />
      </Sheet>
    );
  }
  const cat = cats.get(s.categoryId);
  const hue = categoryHue(categoryLook(cat));
  const keys = lastMonths(monthKey(today), 12);
  const values = placeMonths(s, keys);
  return (
    <Sheet title={s.name} onClose={props.onClose}>
      <div class="detail-title">
        <CategoryIcon category={cat} size="md" />
        <h2>{s.name}</h2>
      </div>
      <section class="card lit detail-hero-card" style={{ '--lit': `color-mix(in oklab, ${hue} 14%, transparent)` }}>
        <div class="detail-stats">
          <div>
            <CountUp class="detail-big num" value={s.yearTotal} format={whole} />
            <span class="card-sub">this year · {s.yearCount} visit{s.yearCount === 1 ? '' : 's'}</span>
          </div>
          <div>
            <span class="detail-mid num">{formatMoney(s.average)}</span>
            <span class="card-sub">a visit on average</span>
          </div>
        </div>
        <span class="card-sub">
          {cat?.name ?? 'Uncategorized'} · since {formatShortDate(s.first)}
          {s.first.slice(0, 4) !== today.slice(0, 4) ? ` ${s.first.slice(0, 4)}` : ''} · {whole(s.total)} in all
        </span>
        <ColumnChart
          title={`${s.name} by month`}
          columns={keys.map((k) => ({ key: k, label: monthLabel(k, { short: true }) }))}
          series={[{ name: 'Spent', color: hue, values }]}
        />
      </section>
      <section class="section">
        <h3 class="section-title">
          <span>Every visit</span>
          <span class="muted small">{s.txns.length}</span>
        </h3>
        <div class="group">
          {s.txns.slice(0, 50).map((t) => (
            <TransactionRow txn={t} category={cats.get(t.categoryId)} account={accts.get(t.accountId)} />
          ))}
        </div>
        {s.txns.length > 50 && (
          <button type="button" class="button wide" onClick={() => nav.showActivity({})}>
            See all in Activity
          </button>
        )}
      </section>
    </Sheet>
  );
}
