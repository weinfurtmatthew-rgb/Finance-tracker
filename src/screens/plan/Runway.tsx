import { Section, Sheet } from "../../components/ui";
import { runway } from "../../lib/plan";
import type { PlanData } from "../../planModel";
import {
  Answer,
  CountField,
  DISCLAIMER,
  MoneyField,
  Progress,
  Stat,
  duration,
  money,
  monthsRange,
  tile,
  useCount,
  useMoney,
} from "./common";

/** Emergency fund: how many months your cash would last, and how long until you reach your target. */
export function RunwayCalc(props: { data: PlanData; onClose: () => void }) {
  const d = props.data;
  const [cash, cashText, setCash] = useMoney(d.cash);
  const [spend, spendText, setSpend] = useMoney(d.monthlySpending);
  const [target, targetText, setTarget] = useCount(6, 24);
  const [saving, savingText, setSaving] = useMoney(
    Math.max(0, d.monthlySurplus),
  );
  const r = runway(cash, spend, target, saving);
  const bare = d.monthlyFixed > 0 ? cash / d.monthlyFixed : Infinity;
  const status =
    r.months >= 6 ? "good" : r.months >= 3 ? "warning" : "critical";

  return (
    <Sheet title="Emergency Fund" onClose={props.onClose}>
      <Answer
        label="Your cash would last"
        value={spend > 0 ? duration(r.months) : "—"}
        sub={
          spend > 0
            ? `if your income stopped and you kept spending ${money(spend)} a month`
            : "Enter your monthly spending"
        }
        status={spend > 0 ? status : undefined}
        statusText={
          status === "good"
            ? "Solid: 6+ months covered"
            : status === "warning"
              ? "Building: 3–6 months is the usual minimum"
              : "Thin: under 3 months"
        }
      />
      {spend > 0 && (
        <div class="plan-block">
          <Progress
            value={cash / Math.max(1, r.target)}
            label={`Progress toward ${target} months`}
          />
          <p class="plan-note">
            {r.gap === 0
              ? `You've reached your ${target}-month target of ${money(r.target)}.`
              : `${money(r.gap)} to go to reach ${target} months (${money(r.target)}).` +
                (r.monthsToTarget != null
                  ? ` At ${money(saving)} a month, that's about ${duration(r.monthsToTarget)}.`
                  : "")}
          </p>
        </div>
      )}
      <div class="kpis two">
        <Stat
          label="Target"
          value={tile(r.target)}
          sub={`${target} months of spending`}
        />
        <Stat
          label="Bills only"
          value={d.monthlyFixed > 0 ? duration(bare, true) : "—"}
          sub="if you cut to fixed bills"
        />
      </div>
      <Section title="Your numbers" footer={DISCLAIMER}>
        <MoneyField
          label="Cash"
          value={cashText}
          set={setCash}
          hint="Checking, savings and cash accounts today"
        />
        <MoneyField
          label="Spending / mo"
          value={spendText}
          set={setSpend}
          hint={`Average of ${monthsRange(d.averagedMonths)}, bills included`}
        />
        <CountField
          label="Target"
          unit="months"
          value={targetText}
          set={setTarget}
          hint="3–6 months is the common advice; more if your income is irregular"
        />
        <MoneyField
          label="Saving / mo"
          value={savingText}
          set={setSaving}
          hint="What you add to cash each month (income minus spending on average)"
        />
      </Section>
    </Sheet>
  );
}
