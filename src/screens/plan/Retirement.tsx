import { Section, Sheet } from '../../components/ui';
import { LineChart } from '../../components/charts';
import { useBook, useTransactions } from '../../hooks';
import { balanceOn } from '../../lib/networth';
import { contributionsByYear, iraLimit, isIra } from '../../lib/ira';
import { DEFAULT_INFLATION, DEFAULT_RETURN, DEFAULT_WITHDRAWAL_RATE, retirementProjection } from '../../lib/plan';
import { todayISO } from '../../lib/dates';
import { useBirthYear } from '../../iraModel';
import { BirthYearField } from '../Ira';
import { Answer, CountField, DISCLAIMER, MoneyField, PercentField, Stat, money, pct, tile, useCount, useMoney, usePercent, yearAxis } from './common';

/** Your IRAs today, Roth and Traditional, and what went in last tax year and this one so far. */
export function useIraTotals() {
  const book = useBook();
  const txns = useTransactions();
  const iras = book.accounts.filter((a) => isIra(a) && !a.archived);
  const roth = iras.filter((a) => a.type === 'roth-ira').reduce((s, a) => s + balanceOn(book, a), 0);
  const traditional = iras.filter((a) => a.type === 'ira').reduce((s, a) => s + balanceOn(book, a), 0);
  const year = Number(todayISO().slice(0, 4));
  const byYear = contributionsByYear(txns);
  return { roth, traditional, total: roth + traditional, lastYear: byYear.get(year - 1) ?? 0, thisYear: byYear.get(year) ?? 0, year };
}

/**
 * Retirement savings: your IRAs today plus what you put in each year, grown at a steady return until
 * the age you retire, in today's dollars, with the monthly income that could pay.
 */
export function RetirementCalc(props: { onClose: () => void }) {
  const ira = useIraTotals();
  const birthYear = useBirthYear();
  const [start, startText, setStart] = useMoney(ira.total);
  const [yearly, yearlyText, setYearly] = useMoney(Math.max(ira.lastYear, ira.thisYear));
  const [retireAge, retireText, setRetire] = useCount(65, 100);
  const [rate, rateText, setRate] = usePercent(DEFAULT_RETURN);
  const [inflation, inflationText, setInflation] = usePercent(DEFAULT_INFLATION);
  const age = birthYear ? ira.year - birthYear : null;
  const years = age == null ? 0 : Math.max(0, retireAge - age);
  const p = retirementProjection({ start, yearly, nominalReturn: rate, inflation, years, withdrawalRate: DEFAULT_WITHDRAWAL_RATE });
  const limit = iraLimit(ira.year, birthYear);
  const axis = yearAxis(years);
  const rothShare = ira.total > 0 ? ira.roth / ira.total : null;

  return (
    <Sheet title="Retirement Savings" onClose={props.onClose}>
      {age == null ? (
        <Answer label="At retirement" value="—" sub="Add your birth year below to see how your IRAs could grow" />
      ) : years === 0 ? (
        <Answer label={`At ${retireAge}`} value={money(start)} sub="You’re at (or past) this age already" />
      ) : (
        <Answer
          label={`At ${retireAge}, in ${ira.year + years}`}
          value={money(p.end.balance)}
          sub={`about ${money(p.real)} in today’s dollars, at ${pct(inflation)} inflation`}
        />
      )}
      {years > 0 && (
        <>
          <div class="kpis">
            <Stat label="You put in" value={tile(p.end.contributed)} />
            <Stat label="Growth" value={tile(p.end.growth)} />
            <Stat label="Per month" value={tile(p.monthlyIncome)} sub={`with the ${pct(DEFAULT_WITHDRAWAL_RATE, 0)} rule, in today’s dollars`} />
          </div>
          {rothShare != null && rothShare > 0 && rothShare < 1 && (
            <p class="section-footer">
              About {pct(rothShare, 0)} is in Roth (tax-free when you take it out) and {pct(1 - rothShare, 0)} in Traditional (taxed as income then), if you
              keep adding in the same mix.
            </p>
          )}
          <Section title="Balance">
            <LineChart
              title="IRA balance and total put in by year"
              dates={axis.dates}
              labels={axis.labels}
              series={[
                { name: 'Balance', color: 'var(--chart-1)', values: p.points.map((x) => x.balance) },
                { name: 'Put in', color: 'var(--chart-2)', values: p.points.map((x) => x.contributed) },
              ]}
            />
          </Section>
        </>
      )}
      <Section title="Your numbers" footer={DISCLAIMER}>
        {!birthYear && <BirthYearField />}
        <CountField label="Retire at" unit="years old" value={retireText} set={setRetire} hint={age != null ? `You’re ${age}` : undefined} />
        <MoneyField
          label="In your IRAs"
          value={startText}
          set={setStart}
          hint={ira.total > 0 ? 'What your IRAs are worth today' : 'Add your IRAs in Net Worth to start from them'}
        />
        <MoneyField
          label="Add / year"
          value={yearlyText}
          set={setYearly}
          hint={
            yearly > limit.limit
              ? `More than the ${ira.year} limit of ${money(limit.limit)}`
              : `You put in ${money(ira.lastYear)} for ${ira.year - 1} and ${money(ira.thisYear)} for ${ira.year} so far. The ${ira.year} limit is ${money(limit.limit)}.`
          }
        />
        <PercentField label="Return / yr" value={rateText} set={setRate} hint="A long-run stock-market average is about 7% a year before inflation" />
        <PercentField label="Inflation" value={inflationText} set={setInflation} hint="Used for the today’s-dollars figure" />
      </Section>
    </Sheet>
  );
}
