import type { Readiness } from '../lib/today';
import { CountUp } from '../components/motion';
import { Sheet } from '../components/ui';
import { Gauge, verdictColor } from '../components/Gauge';

const MEANING: Record<Readiness['verdict'], string> = {
  'Go For It': 'Plenty of room today. Spending more won’t knock anything off course.',
  'On Track': 'You’re in good shape. Normal spending today is fine.',
  'Pace Yourself': 'Some things are stretched. Keep today’s spending to what you need.',
  'Hold Off': 'Money is tight right now. Skip what can wait until payday.',
};

/** What today's Spend Readiness score is made of. */
export function ReadinessSheet(props: { readiness: Readiness; onClose: () => void }) {
  const { score, verdict, factors } = props.readiness;
  return (
    <Sheet title="Spend Readiness" onClose={props.onClose}>
      <div class="readiness-hero">
        <div class="gauge-wrap big">
          <Gauge score={score} verdict={verdict} size={200} stroke={15} />
          <div class="gauge-center">
            <CountUp class="gauge-score num" value={score} format={String} />
            <span class="gauge-of">of 10</span>
          </div>
        </div>
        <h2 class="readiness-verdict">
          <span class="verdict-dot" style={{ background: verdictColor(verdict) }} aria-hidden="true" />
          {verdict}
        </h2>
        <p class="muted">{MEANING[verdict]}</p>
      </div>

      <section class="section">
        <h3 class="section-title">What goes into today’s score</h3>
        <div class="group">
          {factors.map((f) => (
            <div class="factor-row">
              <div class="factor-head">
                <span class="row-title">{f.label}</span>
                <span class="muted small">{Math.round(f.weight * 100)}% of the score</span>
              </div>
              <span class="factor-track" role="meter" aria-label={f.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((f.value ?? 0.7) * 100)}>
                <span class="factor-fill" style={{ width: `${Math.round((f.value ?? 0.7) * 100)}%`, opacity: f.value == null ? 0.4 : 1 }} />
              </span>
              <span class="factor-detail">{f.detail}</span>
            </div>
          ))}
        </div>
        <p class="section-footer">
          Updated every day from your own numbers. 9–10 Go For It · 7–8 On Track · 4–6 Pace Yourself · 0–3 Hold Off. Parts without
          enough data yet count as middling.
        </p>
      </section>
    </Sheet>
  );
}
