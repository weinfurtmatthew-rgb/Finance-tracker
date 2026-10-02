import { useEffect, useMemo, useState } from 'preact/hooks';
import { useCategories, byId } from '../hooks';
import { useNav } from '../nav';
import { todayISO, monthLabel } from '../lib/dates';
import { last12Months, yearPeriod, type Recap, type RecapPeriod } from '../lib/recap';
import { recapCards, type RecapCard } from '../lib/recapCards';
import { formatMoney } from '../lib/money';
import { useRecap, useRecapYears } from '../recapModel';
import { Section, Sheet } from '../components/ui';
import { ColumnChart, RankedBars } from '../components/charts';

/** Choices for the period: this year so far, the last 12 months, and each earlier year with data. */
function usePeriods(): { key: string; period: RecapPeriod }[] {
  const today = todayISO();
  const years = useRecapYears();
  const thisYear = Number(today.slice(0, 4));
  return useMemo(
    () => [
      { key: String(thisYear), period: yearPeriod(thisYear, today) },
      { key: 'last12', period: last12Months(today) },
      ...years.filter((y) => y < thisYear).map((y) => ({ key: String(y), period: yearPeriod(y, today) })),
    ],
    [years.join(), today],
  );
}

/** Full-screen story cards, tap to go through them (like Spotify Wrapped). */
export function RecapStories(props: { period: RecapPeriod; onClose: () => void }) {
  const recap = useRecap(props.period);
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const [i, setI] = useState(0);
  const cards = useMemo(() => (recap ? recapCards(recap, cats) : []), [recap, cats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') setI((x) => Math.min(cards.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [cards.length]);

  if (!recap) return null;
  const card = cards[i];
  const last = i === cards.length - 1;
  return (
    <div class={`story theme-${card.theme}`} role="dialog" aria-modal="true" aria-label={`Year in review: ${recap.period.label}`}>
      <div class="story-progress" aria-hidden="true">
        {cards.map((_, k) => (
          <span class={k < i ? 'done' : k === i ? 'now' : ''} />
        ))}
      </div>
      <button type="button" class="story-close" aria-label="Close" onClick={props.onClose}>
        ✕
      </button>
      <button type="button" class="story-tap left" aria-label="Previous" onClick={() => setI(Math.max(0, i - 1))} />
      <button type="button" class="story-tap right" aria-label={last ? 'Close' : 'Next'} onClick={() => (last ? props.onClose() : setI(i + 1))} />
      <StoryCard card={card} />
      {last && (
        <div class="story-actions">
          <button type="button" class="story-button" onClick={() => void saveRecapImage(recap, cards)}>
            Save as Image
          </button>
        </div>
      )}
      <p class="story-count" aria-live="polite">
        {i + 1} / {cards.length}
      </p>
    </div>
  );
}

function StoryCard(props: { card: RecapCard }) {
  const c = props.card;
  return (
    <div class="story-card" key={c.key}>
      <div class="story-emoji" aria-hidden="true">
        {c.emoji}
      </div>
      <p class="story-kicker">{c.kicker}</p>
      <p class="story-big">{c.big}</p>
      {c.sub && <p class="story-sub">{c.sub}</p>}
      {c.lines?.length ? (
        <ul class="story-lines">
          {c.lines.map((l) => (
            <li>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The recap as a scrolling page, available any time. */
export function RecapPage(props: { onClose: () => void; initialKey?: string }) {
  const nav = useNav();
  const periods = usePeriods();
  const [key, setKey] = useState(props.initialKey ?? periods[0].key);
  const period = (periods.find((p) => p.key === key) ?? periods[0]).period;
  const recap = useRecap(period);
  const categories = useCategories();
  const cats = useMemo(() => byId(categories), [categories]);
  const cards = useMemo(() => (recap ? recapCards(recap, cats) : []), [recap, cats]);

  return (
    <Sheet title="Year in Review" onClose={props.onClose}>
      <div class="recap-top">
        <select class="chip" value={key} aria-label="Period" onChange={(e) => setKey((e.target as HTMLSelectElement).value)}>
          {periods.map((p) => (
            <option value={p.key}>{p.period.label}</option>
          ))}
        </select>
        {recap && recap.days > 0 && (
          <button type="button" class="pill primary" onClick={() => nav.present((close) => <RecapStories period={period} onClose={close} />)}>
            ▶ Play your year
          </button>
        )}
      </div>
      {!recap ? null : recap.days === 0 ? (
        <p class="section-footer intro">No transactions {period.phrase} yet.</p>
      ) : (
        <>
          {recap.days < 90 && <p class="section-footer intro">Based on {recap.days} days of data so far. It fills in as you import more.</p>}
          <RecapCardView card={cards[0]} />
          <MonthsChart recap={recap} />
          {cards.slice(1).map((c) =>
            c.key === 'categories' ? (
              <>
                <RecapCardView card={c} />
                <Section title="By category">
                  <RankedBars
                    items={recap.topCategories.map((t) => ({
                      key: t.id,
                      label: (
                        <>
                          <span aria-hidden="true">{cats.get(t.id)?.emoji}</span> {t.label}
                        </>
                      ),
                      value: t.value,
                      note: `${Math.round(t.share * 100)}%`,
                    }))}
                  />
                </Section>
              </>
            ) : (
              <RecapCardView card={c} />
            ),
          )}
          <Section>
            <button type="button" class="row link-row" onClick={() => void saveRecapImage(recap, cards)}>
              Save as Image
            </button>
          </Section>
        </>
      )}
    </Sheet>
  );
}

function RecapCardView(props: { card: RecapCard }) {
  const c = props.card;
  return (
    <div class={`recap-card theme-${c.theme}`}>
      <span class="recap-kicker">
        <span aria-hidden="true">{c.emoji}</span> {c.kicker}
      </span>
      <span class="recap-big">{c.big}</span>
      {c.sub && <span class="recap-sub">{c.sub}</span>}
      {c.lines?.map((l) => (
        <span class="recap-line">{l}</span>
      ))}
    </div>
  );
}

function MonthsChart(props: { recap: Recap }) {
  const months = props.recap.months;
  if (months.length < 2) return null;
  return (
    <Section title="Month by month">
      <ColumnChart
        title="Spending and income by month"
        columns={months.map((m) => ({ key: m.month, label: monthLabel(m.month, { short: true }) }))}
        series={[
          { name: 'Income', color: 'var(--chart-1)', values: months.map((m) => Math.max(0, m.earned)) },
          { name: 'Spending', color: 'var(--chart-2)', values: months.map((m) => Math.max(0, m.spent)) },
        ]}
      />
    </Section>
  );
}

/** A compact card for the Overview: this year so far, tap for the full recap. */
export function RecapTeaser(props: { onOpen: () => void }) {
  const today = todayISO();
  const period = useMemo(() => yearPeriod(Number(today.slice(0, 4)), today), [today]);
  const recap = useRecap(period);
  if (!recap || recap.days < 14) return null;
  return (
    <button type="button" class="recap-teaser shimmer" onClick={props.onOpen}>
      <span class="card-label">🎬 {recap.period.label}</span>
      <span class="recap-teaser-main">
        <strong>{formatMoney(recap.spent, { whole: true })}</strong> spent
        {recap.earned > 0 && (
          <>
            {' '}
            · <strong>{formatMoney(recap.saved, { whole: true })}</strong> saved
          </>
        )}
      </span>
      <span class="card-sub">
        {[recap.topCategories[0] && `Top: ${recap.topCategories[0].label}`, recap.habit && `#1 spot: ${recap.habit.name}`].filter(Boolean).join(' · ')} · See your year ›
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Save as image: drawn on this phone, shared only where you choose.
// ---------------------------------------------------------------------------------------------

export function drawRecapImage(recap: Recap, cards: RecapCard[], canvas: HTMLCanvasElement) {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1d4ed8');
  g.addColorStop(1, '#7c3aed');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const font = (size: number, weight = 700) => `${weight} ${size}px -apple-system, system-ui, "Segoe UI", sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = font(44, 600);
  ctx.globalAlpha = 0.85;
  ctx.fillText(`My ${recap.period.label}`, 80, 90);
  ctx.globalAlpha = 1;
  ctx.font = font(110, 800);
  ctx.fillText(formatMoney(recap.spent, { whole: true }), 80, 160);
  ctx.font = font(44, 500);
  ctx.fillText('spent', 80, 290);
  const pick = (k: string) => cards.find((c) => c.key === k);
  const rows: [string, string][] = [];
  if (recap.earned > 0) rows.push(['Saved', `${formatMoney(recap.saved, { whole: true })}${recap.savingsRate != null ? ` (${Math.round(recap.savingsRate * 100)}%)` : ''}`]);
  if (pick('categories')) rows.push(['Top category', pick('categories')!.big]);
  if (recap.habit) rows.push(['#1 spot', `${recap.habit.name} · ${recap.habit.visits} visits`]);
  if (recap.noSpend) rows.push(['No-spend days', String(recap.noSpend.days)]);
  if (recap.trips[0]) rows.push(['Top trip', `#${recap.trips[0].tag}`]);
  let y = 420;
  for (const [label, value] of rows.slice(0, 5)) {
    ctx.globalAlpha = 0.75;
    ctx.font = font(36, 500);
    ctx.fillText(label, 80, y);
    ctx.globalAlpha = 1;
    ctx.font = font(56, 700);
    ctx.fillText(value.length > 28 ? `${value.slice(0, 27)}…` : value, 80, y + 46);
    y += 150;
  }
  if (recap.style) {
    ctx.font = font(54, 800);
    ctx.fillText(`${recap.style.emoji} ${recap.style.name}`, 80, H - 170);
  }
  ctx.globalAlpha = 0.6;
  ctx.font = font(30, 500);
  ctx.fillText('Made on my phone with my finance tracker', 80, H - 80);
  ctx.globalAlpha = 1;
}

export async function saveRecapImage(recap: Recap, cards: RecapCard[]) {
  const canvas = document.createElement('canvas');
  drawRecapImage(recap, cards, canvas);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const name = `year-in-review-${recap.period.label.replace(/\s+/g, '-').toLowerCase()}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `My ${recap.period.label}` });
      return;
    } catch {
      // Cancelled: fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
