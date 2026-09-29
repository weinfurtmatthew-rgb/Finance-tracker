import { Section, Sheet } from '../../components/ui';
import { LineChart } from '../../components/charts';
import { DEFAULT_INFLATION, DEFAULT_RETURN, doublingYears, growth, inTodaysDollars, monthsToReach } from '../../lib/plan';
import type { PlanData } from '../../planModel';
import {
  Answer,
  monthsRange,
  CountField,
  DISCLAIMER,
  MoneyField,
  PercentField,
  Stat,
  duration,
  money,
  pct,
  tile,
  useCount,
  useMoney,
  usePercent,
  yearAxis,
} from './common';

/** A typical high-yield savings rate, used when we can't tell what yours earns. */
export const TYPICAL_APY = 0.04;

/**
 * Savings (at your APY) and investment growth share one calculator: a start, a monthly amount, a yearly
 * rate and a number of years, with the result also shown in today's dollars.
 */
export function GrowthCalc(props: { data: PlanData; kind: 'savings' | 'invest'; onClose: () => void }) {
  const d = props.data;
  const savings = props.kind === 'savings';
  const [start, startText, setStart] = useMoney(savings ? d.savings : d.invested);
  const [monthly, monthlyText, setMonthly] = useMoney(savings ? d.savingsMonthly : 0);
  const [rate, rateText, setRate] = usePercent(savings ? (d.apy ?? TYPICAL_APY) : DEFAULT_RETURN);
  const [years, yearsText, setYears] = useCount(savings ? 5 : 20, 60);
  const [inflation, inflationText, setInflation] = usePercent(DEFAULT_INFLATION);
  const [goal, goalText, setGoal] = useMoney(0);

  const points = growth(start, monthly, rate, years);
  const end = points.at(-1)!;
  const real = inTodaysDollars(end.balance, inflation, years);
  const dbl = rate > 0 ? doublingYears(rate) : null;
  const toGoal = goal > 0 ? monthsToReach(start, monthly, rate, goal) : null;
  const axis = yearAxis(years);

  const rateHint = savings
    ? d.apySource === 'account'
      ? 'From the rate on your savings account'
      : d.apySource === 'interest'
        ? 'Estimated from the interest your savings earned this past year'
        : 'A typical high-yield savings rate. Set yours on the savings account.'
    : 'A long-run stock-market average is about 7% a year before inflation';

  return (
    <Sheet title={savings ? 'Savings Growth' : 'Investment Growth'} onClose={props.onClose}>
      <Answer
        label={`In ${years} year${years === 1 ? '' : 's'}`}
        value={money(end.balance)}
        sub={`about ${money(real)} in today's dollars, at ${pct(inflation)} inflation`}
      />
      <div class="kpis">
        <Stat label="You put in" value={tile(end.contributed)} />
        <Stat label={savings ? 'Interest' : 'Growth'} value={tile(end.growth)} />
        <Stat label="Doubles in" value={dbl ? `${dbl.exact.toFixed(1)} yrs` : '—'} sub={dbl ? `Rule of 72: ${dbl.rule72.toFixed(1)}` : undefined} />
      </div>
      {years > 0 && (
        <Section title="Balance">
          <LineChart
            title={`${savings ? 'Savings' : 'Investment'} balance and total deposits by year`}
            dates={axis.dates}
            labels={axis.labels}
            series={[
              {
                name: 'Balance',
                color: 'var(--chart-1)',
                values: points.map((p) => p.balance),
              },
              {
                name: 'Put in',
                color: 'var(--chart-2)',
                values: points.map((p) => p.contributed),
              },
            ]}
          />
        </Section>
      )}
      <Section title="Your numbers">
        <MoneyField
          label="Start with"
          value={startText}
          set={setStart}
          hint={savings ? 'Your savings accounts today' : 'Your investment accounts today'}
        />
        <MoneyField
          label="Add / mo"
          value={monthlyText}
          set={setMonthly}
          hint={savings ? `What went into savings in a typical month (${monthsRange(d.averagedMonths)})` : undefined}
        />
        <PercentField label={savings ? 'APY' : 'Return / yr'} value={rateText} set={setRate} hint={rateHint} />
        <CountField label="Years" unit="yrs" value={yearsText} set={setYears} />
        <PercentField label="Inflation" value={inflationText} set={setInflation} hint="Used for the today's-dollars figure" />
      </Section>
      <Section title="Saving for something?" footer={DISCLAIMER}>
        <MoneyField
          label="Goal"
          value={goalText}
          set={setGoal}
          hint={
            goal > 0
              ? toGoal == null
                ? 'Not reachable with these numbers'
                : toGoal === 0
                  ? 'Already there'
                  : `You'd reach it in about ${duration(toGoal)}`
              : 'Optional: see how long it takes to reach an amount'
          }
        />
      </Section>
    </Sheet>
  );
}
