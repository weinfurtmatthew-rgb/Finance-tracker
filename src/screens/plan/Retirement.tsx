import { Section, Sheet } from '../../components/ui';
import { LineChart } from '../../components/charts';
import { useBook, useTransactions } from '../../hooks';
import { balanceOn } from '../../lib/networth';
import { contributionsByYear, iraLimit, isIra } from '../../lib/ira';
import { is401k, k401Totals } from '../../lib/k401';
import { DEFAULT_INFLATION, DEFAULT_RETURN, DEFAULT_WITHDRAWAL_RATE, retirementProjection } from '../../lib/plan';
import { todayISO } from '../../lib/dates';
import type { AccountType } from '../../types';
import { useBirthYear, usePay } from '../../retirementModel';
import { BirthYearField } from '../Ira';
import { Answer, CountField, DISCLAIMER, MoneyField, PercentField, Stat, money, pct, tile, useCount, useMoney, usePercent, yearAxis } from './common';

/**
 * Your IRAs and 401(k)s today (Roth and pre-tax), what went into IRAs last tax year and this one so
 * far, and a year of your 401(k)s at the rate you put in, with your employer's match.
 */
export function useRetirementTotals() {
  const book = useBook();
  const txns = useTransactions();
  const pay = usePay();
  const birthYear = useBirthYear();
  const open = book.accounts.filter((a) => (isIra(a) || is401k(a)) && !a.archived);
  const sum = (types: AccountType[]) => open.filter((a) => types.includes(a.type)).reduce((s, a) => s + balanceOn(book, a), 0);
  const roth = sum(['roth-ira', 'roth-401k']);
  const pretax = sum(['ira', '401k']);
  const year = Number(todayISO().slice(0, 4));
  const byYear = contributionsByYear(txns);
  const k401 = k401Totals(open, pay, year, birthYear);
  return {
    roth,
    pretax,
    total: roth + pretax,
    hasIra: open.some(isIra),
    has401k: open.some(is401k),
    iraLastYear: byYear.get(year - 1) ?? 0,
    iraThisYear: byYear.get(year) ?? 0,
    k401,
    year,
  };
}

/**
 * Retirement savings: your IRAs and 401(k)s today plus what goes in each year, grown at a steady
 * return until the age you retire, in today's dollars, with the monthly income that could pay.
 */
export function RetirementCalc(props: { onClose: () => void }) {
  const r = useRetirementTotals();
  const birthYear = useBirthYear();
  const k401Yearly = r.k401 ? r.k401.yours + r.k401.match : 0;
  const [start, startText, setStart] = useMoney(r.total);
  const [yearly, yearlyText, setYearly] = useMoney(Math.max(r.iraLastYear, r.iraThisYear) + k401Yearly);
  const [retireAge, retireText, setRetire] = useCount(65, 100);
  const [rate, rateText, setRate] = usePercent(DEFAULT_RETURN);
  const [inflation, inflationText, setInflation] = usePercent(DEFAULT_INFLATION);
  const age = birthYear ? r.year - birthYear : null;
  const years = age == null ? 0 : Math.max(0, retireAge - age);
  const p = retirementProjection({ start, yearly, nominalReturn: rate, inflation, years, withdrawalRate: DEFAULT_WITHDRAWAL_RATE });
  const iraMax = iraLimit(r.year, birthYear).limit;
  // The most that can go in a year: the IRA limit, plus the 401(k) limit and your employer's match.
  const cap = iraMax + (r.k401 ? r.k401.limit.limit + r.k401.match : 0);
  const axis = yearAxis(years);
  const rothShare = r.total > 0 ? r.roth / r.total : null;
  const kinds = r.hasIra && r.has401k ? 'IRAs and 401(k)s' : r.has401k ? '401(k)s' : 'IRAs';

  return (
    <Sheet title="Retirement Savings" onClose={props.onClose}>
      {age == null ? (
        <Answer label="At retirement" value="—" sub="Add your birth year below to see how your retirement savings could grow" />
      ) : years === 0 ? (
        <Answer label={`At ${retireAge}`} value={money(start)} sub="You’re at (or past) this age already" />
      ) : (
        <Answer
          label={`At ${retireAge}, in ${r.year + years}`}
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
              About {pct(rothShare, 0)} is Roth (tax-free when you take it out) and {pct(1 - rothShare, 0)} pre-tax (taxed as income then), if you keep adding
              in the same mix.
            </p>
          )}
          <Section title="Balance">
            <LineChart
              title="Retirement savings and total put in by year"
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
          label="Saved now"
          value={startText}
          set={setStart}
          hint={r.total > 0 ? `What your ${kinds} are worth today` : 'Add your IRAs and 401(k)s in Net Worth to start from them'}
        />
        <MoneyField
          label="Add / year"
          value={yearlyText}
          set={setYearly}
          hint={
            yearly > cap
              ? `More than the ${r.year} limits allow (${money(cap)}${r.k401 ? ' with your employer’s match' : ''})`
              : [
                  k401Yearly > 0 && `About ${money(k401Yearly)} a year goes into your 401(k), with the match.`,
                  (r.hasIra || !r.has401k) &&
                    `IRAs: ${money(r.iraLastYear)} for ${r.year - 1} and ${money(r.iraThisYear)} for ${r.year} so far (the ${r.year} limit is ${money(iraMax)}).`,
                ]
                  .filter(Boolean)
                  .join(' ')
          }
        />
        <PercentField label="Return / yr" value={rateText} set={setRate} hint="A long-run stock-market average is about 7% a year before inflation" />
        <PercentField label="Inflation" value={inflationText} set={setInflation} hint="Used for the today’s-dollars figure" />
      </Section>
    </Sheet>
  );
}
