import type { ComponentChildren } from 'preact';
import { Row, Section, Sheet } from '../../components/ui';
import { useNav } from '../../nav';
import { usePlanData } from '../../planModel';
import { fiPlan, runway, DEFAULT_INFLATION, DEFAULT_RETURN, DEFAULT_WITHDRAWAL_RATE } from '../../lib/plan';
import { DISCLAIMER, duration, money, monthsRange, pct, tile } from './common';
import { RunwayCalc } from './Runway';
import { AffordCalc } from './Afford';
import { DebtCalc } from './Debt';
import { TrueCostCalc } from './TrueCost';
import { RetireCalc } from './Retire';
import { GrowthCalc } from './Growth';

/** The calculators, each starting from your real numbers. */
export function Plan(props: { onClose: () => void }) {
  const nav = useNav();
  const d = usePlanData();
  if (!d)
    return (
      <Sheet title="Plan" onClose={props.onClose}>
        {null}
      </Sheet>
    );

  const r = runway(d.cash, d.monthlySpending, 6, 0);
  const owed = d.debts.reduce((s, x) => s + x.balance, 0);
  const fi = fiPlan({
    annualSpending: d.monthlySpending * 12,
    invested: d.invested,
    monthlyInvesting: 0,
    monthlyIncome: d.monthlyIncome,
    nominalReturn: DEFAULT_RETURN,
    inflation: DEFAULT_INFLATION,
    withdrawalRate: DEFAULT_WITHDRAWAL_RATE,
  });
  const open = (render: (close: () => void) => ComponentChildren) => nav.present(render);

  return (
    <Sheet title="Plan" onClose={props.onClose}>
      <Section
        title="Your numbers"
        footer={`Spending and income are averages of ${monthsRange(d.averagedMonths)}. You can change any number inside a calculator.`}
      >
        <Row title="Cash" detail={money(d.cash)} subtitle="Checking, savings & cash" />
        <Row title="Spending / month" detail={money(d.monthlySpending)} subtitle={`${money(d.monthlyFixed)} of it bills & subscriptions`} />
        <Row
          title="Income / month"
          detail={money(d.monthlyIncome)}
          subtitle={`${d.monthlySurplus >= 0 ? 'Left over' : 'Short'}: ${money(Math.abs(d.monthlySurplus))} a month`}
        />
        <Row title="Invested" detail={money(d.invested)} />
        {owed > 0 && <Row title="Debt" detail={money(owed)} subtitle={`${d.debts.length} card${d.debts.length === 1 ? '' : 's'} & loans`} />}
      </Section>

      <Section title="Decide">
        <Row
          icon="🛟"
          title="Emergency fund"
          subtitle={d.monthlySpending > 0 ? `Your cash covers ${duration(r.months)} of spending` : 'How long your cash would last'}
          onClick={() => open((close) => <RunwayCalc data={d} onClose={close} />)}
        />
        <Row
          icon="🛒"
          title="Can I afford it?"
          subtitle="Check a purchase against your cash and budget"
          onClick={() => open((close) => <AffordCalc data={d} onClose={close} />)}
        />
        <Row
          icon="💳"
          title="Debt payoff"
          subtitle={owed > 0 ? `${money(owed)} owed · avalanche vs snowball` : 'Avalanche vs snowball'}
          onClick={() => open((close) => <DebtCalc data={d} onClose={close} />)}
        />
        <Row
          icon="☕️"
          title="True cost of a habit"
          subtitle={
            d.subscriptionsMonthly > 0
              ? `Subscriptions: ${money(d.subscriptionsMonthly)}/mo, what's that over 10 years?`
              : 'What a habit costs over the years'
          }
          onClick={() => open((close) => <TrueCostCalc data={d} onClose={close} />)}
        />
      </Section>

      <Section title="Grow" footer={DISCLAIMER}>
        <Row
          icon="🏦"
          title="Savings growth"
          subtitle={d.apy != null ? `${tile(d.savings)} at ${pct(d.apy, 2)} APY` : 'What your savings could grow to'}
          onClick={() => open((close) => <GrowthCalc kind="savings" data={d} onClose={close} />)}
        />
        <Row
          icon="📈"
          title="Investment growth"
          subtitle={d.invested > 0 ? `${tile(d.invested)} invested today` : 'How money grows at a steady return'}
          onClick={() => open((close) => <GrowthCalc kind="invest" data={d} onClose={close} />)}
        />
        <Row
          icon="🏝️"
          title="Financial independence"
          subtitle={d.monthlySpending > 0 ? `Your FI number: ${tile(fi.target)}` : 'When could work become optional?'}
          onClick={() => open((close) => <RetireCalc mode="fi" data={d} onClose={close} />)}
        />
        <Row
          icon="🎲"
          title="Will my money last?"
          subtitle="Test a retirement budget in 1,000 markets"
          onClick={() => open((close) => <RetireCalc mode="last" data={d} onClose={close} />)}
        />
      </Section>
    </Sheet>
  );
}
