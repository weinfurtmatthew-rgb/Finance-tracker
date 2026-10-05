import { useMoneyHealth } from '../healthModel';
import { Empty } from '../components/ui';
import type { Pillar } from '../lib/health';
import { IconChip } from '../components/icons';
import { HealthRing, PILLAR_LOOK } from '../components/HealthRing';

const MEANING = {
  Great: 'Your money is in great shape. Keep doing what you’re doing.',
  Good: 'Solid footing, with a part or two that could be stronger.',
  Fair: 'Some parts need attention. Start with the lowest one below.',
  'Needs work': 'A few things are stretched. One step at a time: start with the lowest part below.',
} as const;

/** Scored parts lowest first (where to start), then the ones without enough info. */
const lowestFirst = (a: Pillar, b: Pillar) => (a.score ?? 101) - (b.score ?? 101);

/** The bigger picture: six parts of your finances, each scored 0–100 (Browse → Money Health). */
export function MoneyHealth() {
  const health = useMoneyHealth();
  return (
    <>
      <header class="large-title">
        <h1>Money Health</h1>
      </header>
      {health === undefined ? null : !health ? (
        <Empty icon="shield" title="Not enough info yet">
          <p>Money Health needs a full month of spending and income, plus your checking or savings account. Import a few months of bank files to see it.</p>
        </Empty>
      ) : (
        <>
          <section class="card lit health-hero" style={{ '--lit': 'color-mix(in oklab, var(--hue-aqua) 14%, transparent)' }}>
            <HealthRing pillars={health.pillars} score={health.score} band={health.band} size={196} stroke={14} />
            <p class="health-meaning">{MEANING[health.band]}</p>
            <p class="section-footer center">Updated from your monthly averages and balances. 85+ Great · 65–84 Good · 45–64 Fair · under 45 Needs work.</p>
          </section>
          {[...health.pillars].sort(lowestFirst).map((p) =>
            p.score == null ? (
              <article class="card pillar unknown">
                <div class="pillar-head">
                  <IconChip name={PILLAR_LOOK[p.key].glyph} hue={PILLAR_LOOK[p.key].hue} size="sm" />
                  <h2>{p.name}</h2>
                  <span class="pillar-score num muted" aria-label="Not scored">
                    —
                  </span>
                </div>
                <p class="pillar-metric">
                  <strong>Not enough info</strong> · {p.metric}
                </p>
                <p class="pillar-tip">{p.tip}</p>
              </article>
            ) : (
              <article class="card pillar">
                <div class="pillar-head">
                  <IconChip name={PILLAR_LOOK[p.key].glyph} hue={PILLAR_LOOK[p.key].hue} size="sm" />
                  <h2>{p.name}</h2>
                  <span class="pillar-score num">{p.score}</span>
                </div>
                <span class="factor-track" role="meter" aria-label={p.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.score}>
                  <span class="factor-fill" style={{ width: `${p.score}%`, background: `var(--hue-${PILLAR_LOOK[p.key].hue})` }} />
                </span>
                <p class="pillar-metric">
                  <strong>{p.band}</strong> · {p.metric}
                </p>
                <p class="pillar-tip">{p.tip}</p>
              </article>
            ),
          )}
          <p class="section-footer">
            Weights: spend less than you earn 25%, cash cushion 20%, bills on time, long-term savings and debt load 15% each, planning 10%. A part without
            enough info is left out, and the others count for more.
          </p>
        </>
      )}
    </>
  );
}
