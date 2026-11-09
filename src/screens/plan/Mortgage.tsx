import { useState } from 'preact/hooks';
import { useMeta } from '../../hooks';
import { Row, Section, Segmented, Sheet } from '../../components/ui';
import { PMI_BELOW, PMI_ENDS, mortgage, priceThatFits } from '../../lib/mortgage';
import { addMonths, monthKey, monthLabel, todayISO } from '../../lib/dates';
import type { PlanData } from '../../planModel';
import { Answer, DISCLAIMER, MoneyField, PercentField, Stat, duration, money, monthsRange, pct, tile, useMoney, usePercent } from './common';

/** Housing at or under this share of take-home pay is comfortable; up to the next, tight. */
const COMFORTABLE = 0.28;
const TIGHT = 0.36;
/** Lenders often look for housing at or under this share of gross pay. */
const LENDER_SHARE = 0.28;

const TERMS = [
  { value: '30', label: '30 years' },
  { value: '20', label: '20 years' },
  { value: '15', label: '15 years' },
] as const;

/** "Mar 2031": the month `months` from now. */
const monthFromNow = (months: number) => monthLabel(addMonths(monthKey(todayISO()), months), { short: true });
const monthKeyFromNow = (months: number) => addMonths(monthKey(todayISO()), months);

/** The mortgage calculator: what a home costs a month, over the loan, and against your budget and cash. */
export function MortgageCalc(props: { data: PlanData; onClose: () => void }) {
  const d = props.data;
  const gross = useMeta<number>('grossYearly') ?? 0;
  const [price, priceText, setPrice] = useMoney(0);
  const [downShare, downText, setDown] = usePercent(0.2);
  const [rate, rateText, setRate] = usePercent(0.065);
  const [term, setTerm] = useState<'30' | '20' | '15'>('30');
  const [taxRate, taxText, setTax] = usePercent(0.011);
  const [insurance, insuranceText, setInsurance] = useMoney(200_000);
  const [hoa, hoaText, setHoa] = useMoney(0);
  const [pmiRate, pmiText, setPmi] = usePercent(0.005);
  const [closingRate, closingText, setClosing] = usePercent(0.03);
  const [extra, extraText, setExtra] = useMoney(0);
  const [income, incomeText, setIncome] = useMoney(d.monthlyIncome);
  const [cash, cashText, setCash] = useMoney(d.cash);

  const share = Math.min(1, Math.max(0, downShare));
  const down = Math.round(price * share);
  const costs = { rate, years: Number(term), taxRate, insurance, hoa, pmiRate, extra: 0 };
  const m = mortgage({ ...costs, price, down, extra });
  const closing = Math.round(m.loan * closingRate);
  const cashAfter = cash - down - closing;
  const ofIncome = income > 0 ? m.monthly / income : null;
  const ofGross = gross > 0 ? m.monthly / (gross / 12) : null;
  const fits = income > 0 ? priceThatFits(costs, share, Math.round(income * COMFORTABLE)) : 0;
  const status = ofIncome == null ? undefined : ofIncome <= COMFORTABLE ? 'good' : ofIncome <= TIGHT ? 'warning' : 'critical';
  const saved = m.baseMonths - m.months;

  return (
    <Sheet title="Mortgage" onClose={props.onClose}>
      {price > 0 ? (
        <Answer
          label="Each month"
          value={money(m.monthly)}
          sub={`${money(m.principalAndInterest)} principal & interest · ${money(m.monthly - m.principalAndInterest)} taxes, insurance${m.pmi ? ', PMI' : ''}${hoa ? ', HOA' : ''}`}
          status={status}
          statusText={
            ofIncome == null
              ? undefined
              : `${pct(ofIncome, 0)} of your take-home pay${status === 'good' ? ': comfortable' : status === 'warning' ? ': tight' : ': a stretch'}`
          }
        />
      ) : (
        <Answer
          label="A price that fits"
          value={fits > 0 ? tile(fits) : '—'}
          sub={
            fits > 0
              ? `About ${money(Math.round(income * COMFORTABLE))} a month, ${pct(COMFORTABLE, 0)} of your take-home pay, with ${pct(share, 0)} down. Enter a price to see its payment.`
              : 'Enter a home price, or your take-home pay below.'
          }
        />
      )}

      <Section title="The loan">
        <MoneyField
          label="Home price"
          value={priceText}
          set={setPrice}
          hint={fits > 0 ? `Up to about ${money(fits)} fits ${pct(COMFORTABLE, 0)} of your take-home pay` : undefined}
        />
        <PercentField
          label="Down payment"
          value={downText}
          set={setDown}
          hint={
            price > 0
              ? `${money(down)}${share < PMI_BELOW ? `: under ${pct(PMI_BELOW, 0)}, so lenders add PMI` : ''}`
              : `Under ${pct(PMI_BELOW, 0)}, lenders add PMI`
          }
        />
        <PercentField label="Interest rate" value={rateText} set={setRate} hint="Check today’s rates: lenders quote by credit score and down payment" />
      </Section>
      <Segmented value={term} onChange={setTerm} options={TERMS.map((t) => ({ value: t.value, label: t.label }))} />

      {price > 0 && (
        <>
          <div class="kpis">
            <Stat label="Loan" value={tile(m.loan)} sub={`${pct(m.downShare, 0)} down`} />
            <Stat label="Interest" value={tile(m.totalInterest)} sub={`over ${duration(m.months)}`} />
            <Stat
              label="Paid off"
              value={monthKeyFromNow(m.months).slice(0, 4)}
              sub={`${monthLabel(monthKeyFromNow(m.months), { short: true }).split(' ')[0]}${saved > 0 ? ` · ${duration(saved, true)} sooner` : ''}`}
            />
          </div>

          <Section
            title="Each month"
            footer={m.pmi ? `PMI stops once you owe ${pct(PMI_ENDS, 0)} of the price, after about ${duration(m.pmiMonths)}.` : undefined}
          >
            <Row title="Principal & interest" detail={money(m.principalAndInterest)} />
            <Row title="Property tax" subtitle={`${pct(taxRate, 2)} of the price a year`} detail={money(m.tax)} />
            <Row title="Home insurance" detail={money(m.insurance)} />
            {m.pmi > 0 && <Row title="PMI" subtitle={`Until about ${monthFromNow(m.pmiMonths)}`} detail={money(m.pmi)} />}
            {hoa > 0 && <Row title="HOA" detail={money(hoa)} />}
            {d.monthlyHousing > 0 && (
              <Row
                title="Vs your housing now"
                subtitle={`${money(d.monthlyHousing)} a month for rent or mortgage, on average`}
                detail={`${m.monthly >= d.monthlyHousing ? '+' : '−'}${money(Math.abs(m.monthly - d.monthlyHousing))}`}
                wrap
              />
            )}
          </Section>

          <Section
            title="Your budget"
            footer={`Housing at ${pct(COMFORTABLE, 0)} of take-home pay or less is comfortable; over ${pct(TIGHT, 0)} is a stretch. Lenders often look for ${pct(LENDER_SHARE, 0)} of gross pay or less.`}
          >
            {ofIncome != null && <Row title="Of your take-home pay" subtitle={`${money(income)} a month`} detail={pct(ofIncome, 0)} />}
            {ofGross != null && <Row title="Of your gross pay" subtitle={`${money(gross)} a year (from the rent calculator)`} detail={pct(ofGross, 0)} />}
            {fits > 0 && (
              <Row
                title="A price that fits"
                subtitle={`${pct(COMFORTABLE, 0)} of take-home, with these costs and ${pct(share, 0)} down`}
                detail={money(fits)}
                wrap
              />
            )}
          </Section>

          <Section title="Cash to buy" footer="Closing costs are often 2% to 5% of the loan.">
            <Row title="Down payment" detail={money(down)} />
            <Row title="Closing costs" subtitle={`About ${pct(closingRate, 1)} of the loan`} detail={money(closing)} />
            <Row
              title="Cash left after"
              subtitle={
                cashAfter < 0
                  ? `${money(-cashAfter)} more than your cash`
                  : d.monthlySpending > 0
                    ? `${duration(cashAfter / d.monthlySpending)} of spending`
                    : undefined
              }
              detail={cashAfter < 0 ? '—' : money(cashAfter)}
              wrap
            />
          </Section>

          <Section
            title="Pay extra"
            footer={
              extra > 0 && saved > 0
                ? `Paid off ${duration(saved)} sooner, with ${money(m.baseInterest - m.totalInterest)} less interest.`
                : 'Extra toward the principal each month shortens the loan and cuts the interest.'
            }
          >
            <MoneyField label="Extra / month" value={extraText} set={setExtra} />
          </Section>
        </>
      )}

      <Section title="Costs">
        <PercentField label="Property tax" value={taxText} set={setTax} hint="A year, as a share of the price; about 1% is typical in the US" />
        <MoneyField label="Insurance / year" value={insuranceText} set={setInsurance} />
        <MoneyField label="HOA / month" value={hoaText} set={setHoa} />
        <PercentField label="PMI" value={pmiText} set={setPmi} hint="A year, as a share of the loan, when less than 20% is down" />
        <PercentField label="Closing costs" value={closingText} set={setClosing} hint="As a share of the loan" />
      </Section>

      <Section title="Your numbers" footer={DISCLAIMER}>
        <MoneyField label="Take-home / mo" value={incomeText} set={setIncome} hint={`Average of ${monthsRange(d.averagedMonths)}`} />
        <MoneyField label="Cash" value={cashText} set={setCash} hint="Checking, savings and cash accounts today" />
      </Section>
    </Sheet>
  );
}
