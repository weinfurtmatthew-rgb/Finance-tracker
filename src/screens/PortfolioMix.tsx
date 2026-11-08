/**
 * The Portfolio page's mix and dividends: what your investments are made of (and how far that is from
 * a mix you aim for), where a lot rides on a few companies, and the dividends coming in.
 */
import { useMemo, useState } from 'preact/hooks';
import { deleteMeta, setMeta } from '../db';
import { useAccounts, useMeta } from '../hooks';
import { useNav } from '../nav';
import { useSecurities } from '../portfolioModel';
import { DRIFT_POINTS, KINDS, TARGET_MIX, concentration, drift, mixByKind, stocksBySector, type AssetKind, type TargetMix } from '../lib/mix';
import { dividendSummary, type DividendSummary } from '../lib/dividends';
import type { Portfolio } from '../lib/portfolio';
import { formatShortDate, monthLabel, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Field, Row, Section, Sheet } from '../components/ui';
import { ColumnChart, RankedBars } from '../components/charts';
import { HoldingSheet, KindFields } from './Holdings';

const whole = (c: number) => formatMoney(c, { whole: true });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** By kind, how far that is from your target, and where a lot rides on a few companies. */
export function MixSection(props: { p: Portfolio }) {
  const nav = useNav();
  const securities = useSecurities();
  const target = useMeta<TargetMix>(TARGET_MIX);
  const mix = useMemo(() => mixByKind(props.p, securities), [props.p, securities]);
  const sectors = useMemo(() => stocksBySector(props.p, securities), [props.p, securities]);
  const risks = useMemo(() => concentration(props.p, securities), [props.p, securities]);
  const off = target ? drift(mix, target).filter((d) => Math.abs(d.share - d.target) > DRIFT_POINTS) : [];
  const setTarget = () => nav.present((close) => <TargetMixSheet onClose={close} />);
  const setKinds = () => nav.present((close) => <SetKindsSheet p={props.p} onClose={close} />);
  return (
    <>
      <Section
        title={
          <>
            <span>Mix</span>
            <button type="button" class="link" onClick={setTarget}>
              {target ? 'Target' : 'Set Target'}
            </button>
          </>
        }
        footer={
          mix.unknown.length
            ? `What ${mix.unknown.join(', ')} ${mix.unknown.length === 1 ? 'holds isn’t' : 'hold isn’t'} known: tap Not set to say.`
            : 'Cash is what’s in these accounts beside the holdings.'
        }
      >
        <RankedBars
          items={mix.slices.map((s) => ({
            key: s.key,
            label: s.label,
            value: s.value,
            note: `${pct(s.share)}${target && s.key !== 'unset' ? ` · target ${pct(target[s.key as AssetKind] ?? 0)}` : ''}`,
          }))}
          onSelect={(key) => key === 'unset' && setKinds()}
        />
      </Section>
      {target && (
        <Section title="Vs your target" footer="New money into what’s under its target gets back to it without selling (and the taxes that can bring).">
          {off.map((d) => (
            <Row
              title={`${d.label}: ${pct(d.share)}, target ${pct(d.target)}`}
              subtitle={d.change > 0 ? `${whole(d.change)} more would put it on target` : `${whole(-d.change)} over its target`}
              chevron={false}
            />
          ))}
          {!off.length && <Row title="On target" subtitle={`Every kind is within ${pct(DRIFT_POINTS)} of your target mix`} chevron={false} />}
        </Section>
      )}
      {risks.length > 0 && (
        <Section
          title="Concentration"
          footer="Funds hold many companies, so they don’t count here. Spreading money out means one company’s bad year matters less."
        >
          {risks.map((r) => (
            <div class="row row-note concentration">{r.text}</div>
          ))}
        </Section>
      )}
      {sectors.length > 0 && (
        <Section title="Companies by sector" footer="Your individual companies’ share of everything, by industry. Funds are left out.">
          <RankedBars
            items={sectors.map((s) => ({ key: s.key, label: s.label, value: s.value, note: pct(s.share) }))}
            onSelect={(key) => key === 'Not set' && setKinds()}
          />
        </Section>
      )}
    </>
  );
}

/** Saying what holdings hold, and companies' sectors, all in one place. */
function SetKindsSheet(props: { p: Portfolio; onClose: () => void }) {
  const securities = useSecurities();
  const tickers = [...new Set(props.p.accounts.flatMap((hs) => hs.positions.filter((x) => x.value > 0).map((x) => x.ticker)))].sort();
  return (
    <Sheet title="What They Hold" onClose={props.onClose}>
      <Section footer="For the mix on the Portfolio page. A fund’s page or your brokerage says what it holds; a target-date or balanced fund is Other.">
        {tickers.map((t) => (
          <KindFields ticker={t} security={securities.get(t)} label={t} />
        ))}
      </Section>
    </Sheet>
  );
}

/** A mix to aim for: each kind's share. */
export function TargetMixSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const target = useMeta<TargetMix>(TARGET_MIX);
  const [text, setText] = useState<Record<string, string>>(() =>
    Object.fromEntries(KINDS.map((k) => [k.value, target?.[k.value] != null ? String(Math.round(target[k.value]! * 100)) : ''])),
  );
  const numbers = KINDS.map((k) => Number(text[k.value] || 0));
  const sum = numbers.reduce((s, n) => s + n, 0);
  const valid = numbers.every((n) => Number.isFinite(n) && n >= 0) && Math.abs(sum - 100) < 0.01;
  const save = async () => {
    if (!valid) return;
    const next: TargetMix = {};
    KINDS.forEach((k, i) => numbers[i] > 0 && (next[k.value] = numbers[i] / 100));
    await setMeta(TARGET_MIX, next);
    nav.toast('Target mix saved');
    props.onClose();
  };
  const remove = async () => {
    await deleteMeta(TARGET_MIX);
    nav.toast('Target mix removed');
    props.onClose();
  };
  return (
    <Sheet title="Target Mix" onClose={props.onClose} onSave={save} saveDisabled={!valid}>
      <Section
        footer={
          valid
            ? 'The Portfolio page shows how far each kind is from this, and what would put it back: new money into what’s under, rather than selling, avoids taxes.'
            : `They add up to ${sum}%: make it 100%.`
        }
      >
        {KINDS.map((k) => (
          <Field label={k.label}>
            <input
              inputMode="decimal"
              value={text[k.value]}
              placeholder="0"
              onInput={(e) => setText({ ...text, [k.value]: (e.target as HTMLInputElement).value })}
            />
            <span class="affix">%</span>
          </Field>
        ))}
      </Section>
      {target && (
        <Section>
          <button type="button" class="row danger-row" onClick={() => void remove()}>
            Remove Target
          </button>
        </Section>
      )}
    </Sheet>
  );
}

/** Dividends at a glance on the Portfolio page. */
export function DividendsSection(props: { p: Portfolio; value: number }) {
  const nav = useNav();
  const today = todayISO();
  const d = useMemo(() => dividendSummary(props.p, today, props.value), [props.p, today, props.value]);
  if (!d) return null;
  const open = () => nav.present((close) => <DividendsSheet p={props.p} d={d} onClose={close} />);
  return (
    <Section title="Dividends" footer="The next 12 months assumes each keeps paying what it did in the last 12, on the shares you hold now.">
      <Row
        title="Last 12 months"
        subtitle={
          d.reinvested12 > 0
            ? `${whole(d.reinvested12)} reinvested${d.last12 > d.reinvested12 ? ` · ${whole(d.last12 - d.reinvested12)} paid to cash` : ''}`
            : undefined
        }
        detail={whole(d.last12)}
        onClick={open}
      />
      {d.next12 > 0 && (
        <Row
          title="Next 12 months"
          subtitle={[d.yield != null && `${pct1(d.yield)} yield`, `about ${whole(d.next12 / 12)} a month`].filter(Boolean).join(' · ')}
          detail={`about ${whole(d.next12)}`}
          onClick={open}
        />
      )}
      {d.upcoming.slice(0, 3).map((u) => (
        <Row title={`Next from ${u.ticker}`} subtitle={`around ${formatShortDate(u.date)}`} detail={`about ${whole(u.amount)}`} onClick={open} />
      ))}
    </Section>
  );
}

/** Dividends month by month, and what each holding pays. */
function DividendsSheet(props: { p: Portfolio; d: DividendSummary; onClose: () => void }) {
  const nav = useNav();
  const accounts = useAccounts();
  const { d } = props;
  const openHolding = (ticker: string) => {
    const pos = props.p.accounts.flatMap((hs) => hs.positions).find((x) => x.ticker === ticker && x.value > 0);
    const account = pos && accounts.find((a) => a.id === pos.accountId);
    if (account) nav.present((close) => <HoldingSheet account={account} ticker={ticker} onClose={close} />);
  };
  return (
    <Sheet title="Dividends" onClose={props.onClose}>
      <section class="card detail-hero-card">
        <span class="card-label">Last 12 months</span>
        <span class="detail-mid num">{whole(d.last12)}</span>
        <ColumnChart
          title="Dividends received each month, the last 12 months"
          columns={d.months.map((m) => ({ key: m.key, label: monthLabel(m.key, { short: true }) }))}
          series={[{ name: 'Dividends', color: 'var(--chart-1)', values: d.months.map((m) => m.amount) }]}
          height={110}
        />
      </section>
      <Section
        title="By holding"
        footer="Dates and amounts ahead are estimates from each one’s last payments. Dividends count on the day the shares go ex-dividend."
      >
        {d.outlook.map((o) => (
          <Row
            title={o.ticker}
            subtitle={[`${pct1(o.yield)} yield`, o.every, o.next && `next ~${formatShortDate(o.next.date)}`].filter(Boolean).join(' · ')}
            detail={`${whole(o.yearly)}/yr`}
            onClick={() => openHolding(o.ticker)}
          />
        ))}
        {!d.outlook.length && <div class="row muted">None of what you hold now paid a dividend in the last year.</div>}
      </Section>
    </Sheet>
  );
}
