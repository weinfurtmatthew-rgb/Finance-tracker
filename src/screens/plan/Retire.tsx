import { useMemo, useState } from 'preact/hooks';
import { Section, Segmented, Sheet } from '../../components/ui';
import { LineChart } from '../../components/charts';
import { DEFAULT_INFLATION, DEFAULT_RETURN, DEFAULT_WITHDRAWAL_RATE, fiPlan, growth, realRate, simulateRetirement } from '../../lib/plan';
import type { PlanData } from '../../planModel';
import {
  Answer,
  CountField,
  DISCLAIMER,
  MoneyField,
  PercentField,
  Progress,
  Stat,
  duration,
  money,
  monthsRange,
  pct,
  tile,
  useCount,
  useMoney,
  usePercent,
  yearAxis,
} from './common';

/** Financial independence ("when could I stop working?") and a Monte Carlo "will my money last?". */
export function RetireCalc(props: { data: PlanData; mode?: 'fi' | 'last'; onClose: () => void }) {
  const [mode, setMode] = useState(props.mode ?? 'fi');
  return (
    <Sheet title={mode === 'fi' ? 'Financial Independence' : 'Will My Money Last?'} onClose={props.onClose}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'fi', label: 'When can I retire?' },
          { value: 'last', label: 'Will it last?' },
        ]}
      />
      {mode === 'fi' ? <Fi data={props.data} /> : <Last data={props.data} />}
    </Sheet>
  );
}

function Fi(props: { data: PlanData }) {
  const d = props.data;
  const [spend, spendText, setSpend] = useMoney(d.monthlySpending * 12);
  const [invested, investedText, setInvested] = useMoney(d.invested);
  const [monthly, monthlyText, setMonthly] = useMoney(Math.max(0, d.monthlySurplus));
  const [ret, retText, setRet] = usePercent(DEFAULT_RETURN);
  const [inflation, inflationText, setInflation] = usePercent(DEFAULT_INFLATION);
  const [wr, wrText, setWr] = usePercent(DEFAULT_WITHDRAWAL_RATE);
  const plan = fiPlan({
    annualSpending: spend,
    invested,
    monthlyInvesting: monthly,
    monthlyIncome: d.monthlyIncome,
    nominalReturn: ret,
    inflation,
    withdrawalRate: Math.max(0.005, wr),
  });
  const horizon = Math.min(60, Math.max(10, Math.ceil(plan.years ?? 40)));
  const path = growth(invested, monthly, realRate(ret, inflation), horizon);
  const axis = yearAxis(horizon);
  const year = plan.years != null ? new Date().getFullYear() + Math.ceil(plan.years) : null;

  return (
    <>
      <Answer
        label="Your FI number"
        value={money(plan.target)}
        sub={`${pct(wr)} of this covers ${money(spend)} a year of spending, in today's dollars`}
      />
      <div class="plan-block">
        <Progress value={invested / Math.max(1, plan.target)} label="Progress toward your FI number" />
        <p class="plan-note">
          {pct(invested / Math.max(1, plan.target), 0)} of the way there with {money(invested)} invested.
        </p>
      </div>
      <div class="kpis">
        <Stat
          label="Years to FI"
          value={plan.years == null ? '—' : plan.years === 0 ? 'Now' : duration(plan.years * 12, true)}
          sub={year && plan.years ? `around ${year}` : 'at this pace'}
        />
        <Stat label="Savings rate" value={d.monthlyIncome > 0 ? pct(plan.savingsRate, 0) : '—'} sub="of income invested" />
        <Stat label="Real return" value={pct(realRate(ret, inflation))} sub="after inflation" />
      </div>
      <Section title="Invested, in today's dollars">
        <LineChart
          title="Projected investments by year in today's dollars"
          dates={axis.dates}
          labels={axis.labels}
          series={[
            {
              name: 'Invested',
              color: 'var(--chart-1)',
              values: path.map((p) => p.balance),
            },
          ]}
        />
      </Section>
      <Section
        title="Your numbers"
        footer={`The ${pct(DEFAULT_WITHDRAWAL_RATE)} rule comes from past US markets, where withdrawing 4% in the first year (then adjusting for inflation) lasted 30 years in most periods. “Will it last?” tests it against more cautious random markets. ${DISCLAIMER}`}
      >
        <MoneyField label="Spending / yr" value={spendText} set={setSpend} hint={`12 × your average month (${monthsRange(d.averagedMonths)})`} />
        <MoneyField label="Invested now" value={investedText} set={setInvested} hint="Your investment accounts today" />
        <MoneyField label="Invest / mo" value={monthlyText} set={setMonthly} hint="Defaults to what you have left over each month on average" />
        <PercentField label="Return / yr" value={retText} set={setRet} />
        <PercentField label="Inflation" value={inflationText} set={setInflation} />
        <PercentField
          label="Withdrawal rate"
          value={wrText}
          set={setWr}
          hint="3–4% is the usual range; lower is safer for retirements longer than 30 years"
        />
      </Section>
    </>
  );
}

function Last(props: { data: PlanData }) {
  const d = props.data;
  // With less than ~20 years of spending invested, start from the FI number so the example is meaningful.
  const fiNumber = d.monthlySpending * 12 * 25;
  const useInvested = d.invested >= d.monthlySpending * 12 * 20;
  const [balance, balanceText, setBalance] = useMoney(useInvested ? d.invested : fiNumber);
  const [withdraw, withdrawText, setWithdraw] = useMoney(d.monthlySpending * 12);
  const [years, yearsText, setYears] = useCount(30, 60);
  const [ret, retText, setRet] = usePercent(DEFAULT_RETURN);
  const [vol, volText, setVol] = usePercent(0.15);
  const [inflation, inflationText, setInflation] = usePercent(DEFAULT_INFLATION);
  const sim = useMemo(
    () =>
      years > 0 && balance > 0
        ? simulateRetirement({
            balance,
            annualWithdrawal: withdraw,
            years,
            meanReturn: ret,
            volatility: vol,
            inflation,
          })
        : null,
    [balance, withdraw, years, ret, vol, inflation],
  );
  const axis = yearAxis(years);
  const s = sim?.successRate ?? 0;
  const status = s >= 0.85 ? 'good' : s >= 0.6 ? 'warning' : 'critical';

  return (
    <>
      {sim ? (
        <>
          <Answer
            label={`Money lasted ${years} years in`}
            value={pct(s, 0)}
            sub={`of 1,000 simulated markets, withdrawing ${money(withdraw)} a year (${pct(withdraw / balance)} to start), raised with inflation`}
            status={status}
            statusText={
              status === 'good' ? 'Likely to last' : status === 'warning' ? 'Risky: consider spending less or working longer' : 'Unlikely to last'
            }
          />
          {sim.runsOutYearP10 != null && <p class="plan-note">In the worst 10% of markets, the money runs out by year {sim.runsOutYearP10}.</p>}
          <div class="kpis">
            <Stat label="Bad markets" value={tile(sim.ending.p10)} sub="left at the end" />
            <Stat label="Typical" value={tile(sim.ending.p50)} sub="left at the end" />
            <Stat label="Good markets" value={tile(sim.ending.p90)} sub="left at the end" />
          </div>
          <Section title="Typical balance, in today's dollars">
            <LineChart
              title="Median simulated balance by year, in today's dollars"
              dates={axis.dates}
              labels={axis.labels}
              series={[
                {
                  name: 'Typical balance',
                  color: 'var(--chart-1)',
                  values: sim.medianPath,
                },
              ]}
            />
          </Section>
        </>
      ) : (
        <p class="plan-note">Enter a starting balance and number of years.</p>
      )}
      <Section
        title="Your numbers"
        footer={`Each simulated year earns a random return around ${pct(ret)} (swings of about ±${pct(vol, 0)}), then the withdrawal comes out. Results are in today's dollars. ${DISCLAIMER}`}
      >
        <MoneyField
          label="Start with"
          value={balanceText}
          set={setBalance}
          hint={
            useInvested ? 'Your investment accounts today' : `Your FI number (25 × yearly spending). You have ${money(d.invested)} invested today.`
          }
        />
        <MoneyField label="Spend / yr" value={withdrawText} set={setWithdraw} hint="Taken out each year, raised with inflation" />
        <CountField label="For" unit="years" value={yearsText} set={setYears} />
        <PercentField label="Return / yr" value={retText} set={setRet} />
        <PercentField
          label="Market swings"
          value={volText}
          set={setVol}
          hint="Yearly volatility: about 15–18% for all stocks, 10% for a 60/40 stock–bond mix"
        />
        <PercentField label="Inflation" value={inflationText} set={setInflation} />
      </Section>
    </>
  );
}
