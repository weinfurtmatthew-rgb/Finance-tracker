import { useState } from "preact/hooks";
import { Section, Segmented, Sheet } from "../../components/ui";
import { DEFAULT_RETURN, affordability } from "../../lib/plan";
import type { PlanData } from "../../planModel";
import {
  Answer,
  CountField,
  DISCLAIMER,
  MoneyField,
  PercentField,
  Stat,
  duration,
  money,
  monthsRange,
  pct,
  tile,
  useCount,
  useMoney,
  usePercent,
} from "./common";

const VERDICT = {
  comfortable: { status: "good", text: "Comfortable" },
  tight: { status: "warning", text: "Tight" },
  stretch: { status: "critical", text: "A stretch" },
} as const;

/** "Can I afford it?": a purchase checked against your cash cushion, bills and monthly budget. */
export function AffordCalc(props: { data: PlanData; onClose: () => void }) {
  const d = props.data;
  const [price, priceText, setPrice] = useMoney(0);
  const [how, setHow] = useState<"cash" | "finance">("cash");
  const [down, downText, setDown] = useMoney(0);
  const [apr, aprText, setApr] = usePercent(0.07);
  const [term, termText, setTerm] = useCount(60, 480);
  const [cash, cashText, setCash] = useMoney(d.cash);
  const [spend, spendText, setSpend] = useMoney(d.monthlySpending);
  const [surplusText, setSurplusText] = useState(
    String(Math.round(d.monthlySurplus / 100)),
  );
  const surplus = Math.round(
    (parseFloat(surplusText.replace(/[$,]/g, "")) || 0) * 100,
  );

  const a = affordability({
    price,
    financed: how === "finance",
    downPayment: down,
    apr,
    months: term,
    cash,
    monthlySpending: spend,
    monthlySurplus: surplus,
    leftAfterBills: d.leftAfterBills,
    returnRate: DEFAULT_RETURN,
  });
  const v = VERDICT[a.verdict];

  return (
    <Sheet title="Can I Afford It?" onClose={props.onClose}>
      <Section>
        <MoneyField label="Price" value={priceText} set={setPrice} />
      </Section>
      <Segmented
        value={how}
        onChange={setHow}
        options={[
          { value: "cash", label: "Pay in full" },
          { value: "finance", label: "Finance it" },
        ]}
      />
      {how === "finance" && (
        <Section>
          <MoneyField label="Down payment" value={downText} set={setDown} />
          <PercentField label="APR" value={aprText} set={setApr} />
          <CountField
            label="Term"
            unit="months"
            value={termText}
            set={setTerm}
          />
        </Section>
      )}

      {price > 0 && (
        <>
          <Answer
            label="Verdict"
            value={v.text}
            sub={a.reasons.join(" ")}
            status={v.status}
            statusText={
              a.verdict === "comfortable"
                ? "Fits your cushion and budget"
                : a.verdict === "tight"
                  ? "Doable, with less margin"
                  : "Would strain your finances"
            }
          />
          <div class="kpis">
            <Stat
              label="Cash after"
              value={tile(a.cashAfter)}
              sub={`was ${tile(cash)}`}
            />
            <Stat
              label="Cushion"
              value={duration(Math.max(0, a.runwayAfter), true)}
              sub={`was ${duration(a.runwayBefore)}`}
            />
            {a.monthlyPayment > 0 ? (
              <Stat
                label="Payment"
                value={tile(a.monthlyPayment)}
                sub={`${money(a.totalInterest)} interest`}
              />
            ) : (
              <Stat
                label="Left / mo"
                value={tile(a.surplusAfter)}
                sub="unchanged"
              />
            )}
          </div>
          {a.leftAfterBillsAfter != null && (
            <p class="plan-note">
              Left after bills before your next paycheck:{" "}
              <strong>{money(a.leftAfterBillsAfter)}</strong>
            </p>
          )}
          {a.upfront > 0 && (
            <Section
              title="If you invested it instead"
              footer={`At a ${pct(DEFAULT_RETURN)} yearly return, before inflation.`}
            >
              {a.opportunity.map((o) => (
                <div class="row">
                  <span class="row-main">
                    <span class="row-title">In {o.years} years</span>
                  </span>
                  <span class="row-detail">{money(o.value)}</span>
                </div>
              ))}
            </Section>
          )}
        </>
      )}

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
          hint={`Average of ${monthsRange(d.averagedMonths)}`}
        />
        <MoneyField
          label="Left over / mo"
          value={surplusText}
          set={setSurplusText}
          hint="Income minus spending on average (can be negative)"
        />
      </Section>
    </Sheet>
  );
}
