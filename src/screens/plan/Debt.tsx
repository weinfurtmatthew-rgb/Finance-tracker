import { useState } from "preact/hooks";
import { Field, Section, Segmented, Sheet } from "../../components/ui";
import { LineChart } from "../../components/charts";
import { payoff, type Debt } from "../../lib/plan";
import { parseUserAmount } from "../../lib/money";
import { addMonths, monthKey, monthLabel, todayISO } from "../../lib/dates";
import { newId } from "../../db";
import type { PlanData } from "../../planModel";
import {
  Answer,
  DISCLAIMER,
  MoneyField,
  Stat,
  duration,
  money,
  useMoney,
} from "./common";

interface Row {
  id: string;
  name: string;
  balance: string;
  apr: string;
  min: string;
  typical: boolean;
}

const toRow = (d: PlanData["debts"][number]): Row => ({
  id: d.id,
  name: d.name,
  balance: String(Math.round(d.balance / 100)),
  apr: String(Math.round(d.apr * 10000) / 100),
  min: String(Math.round(d.minPayment / 100)),
  typical: d.aprEstimated || d.minEstimated,
});

/** Debt payoff: highest rate first (avalanche) vs smallest balance first (snowball). */
export function DebtCalc(props: { data: PlanData; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => props.data.debts.map(toRow));
  const [extra, extraText, setExtra] = useMoney(0);
  const [pick, setPick] = useState<"avalanche" | "snowball">("avalanche");

  const debts: Debt[] = rows.map((r) => ({
    id: r.id,
    name: r.name || "Debt",
    balance: parseUserAmount(r.balance) ?? 0,
    apr: (parseFloat(r.apr) || 0) / 100,
    minPayment: parseUserAmount(r.min) ?? 0,
  }));
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const mins = debts.reduce(
    (s, d) => s + (d.balance > 0 ? d.minPayment : 0),
    0,
  );
  const av = payoff(debts, extra, "avalanche");
  const sb = payoff(debts, extra, "snowball");
  const chosen = pick === "avalanche" ? av : sb;
  const saved = sb.totalInterest - av.totalInterest;
  // With one debt (or when the orders coincide) there's nothing to compare.
  const same =
    av.months === sb.months &&
    av.totalInterest === sb.totalInterest &&
    av.order.map((o) => o.id).join() === sb.order.map((o) => o.id).join();
  const current = monthKey(todayISO());

  const update = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const onText = (id: string, key: keyof Row) => (e: Event) =>
    update(id, { [key]: (e.target as HTMLInputElement).value });

  // Chart: total owed month by month, both strategies (sampled to keep it light).
  const len = Math.max(av.remaining.length, sb.remaining.length);
  const step = Math.max(1, Math.ceil(len / 60));
  const idx = Array.from({ length: Math.ceil((len + 1) / step) }, (_, i) =>
    Math.min(len, i * step),
  );
  const at = (rem: number[], i: number) =>
    i === 0 ? total : (rem[Math.min(i, rem.length) - 1] ?? 0);

  return (
    <Sheet title="Debt Payoff" onClose={props.onClose}>
      {total > 0 && mins > 0 ? (
        <>
          {av.neverPaidOff ? (
            <Answer
              label="Debt-free in"
              value="Never"
              sub="These payments don't cover the interest. Raise the minimums or add an extra amount."
              status="critical"
              statusText="Payments too low"
            />
          ) : (
            <Answer
              label="Debt-free in"
              value={duration(chosen.months)}
              sub={`${monthLabel(addMonths(current, chosen.months))}, paying ${money(mins + extra)} a month`}
              status={saved > 0 ? "good" : undefined}
              statusText={
                saved > 0
                  ? `Avalanche saves ${money(saved)} in interest`
                  : undefined
              }
            />
          )}
          {same ? (
            <p class="plan-note">
              Total interest: <strong>{money(av.totalInterest)}</strong>.{" "}
              {debts.length > 1
                ? "Avalanche and snowball pay these off in the same order."
                : "Add another debt to compare avalanche and snowball."}
            </p>
          ) : (
            <>
              <Segmented
                value={pick}
                onChange={setPick}
                options={[
                  { value: "avalanche", label: "Avalanche" },
                  { value: "snowball", label: "Snowball" },
                ]}
              />
              <p class="plan-note">
                {pick === "avalanche"
                  ? "Pays the highest interest rate first. Costs the least overall."
                  : "Pays the smallest balance first. You clear whole debts sooner, which keeps many people motivated."}
              </p>
              <div class="kpis two">
                <Stat
                  label="Avalanche"
                  value={av.neverPaidOff ? "—" : duration(av.months, true)}
                  sub={`${money(av.totalInterest)} interest`}
                />
                <Stat
                  label="Snowball"
                  value={sb.neverPaidOff ? "—" : duration(sb.months, true)}
                  sub={`${money(sb.totalInterest)} interest`}
                />
              </div>
            </>
          )}
          {!chosen.neverPaidOff && (
            <Section title="Payoff order">
              {chosen.order.map((o, i) => (
                <div class="row">
                  <span class="row-icon order-num">{i + 1}</span>
                  <span class="row-main">
                    <span class="row-title">{o.name}</span>
                  </span>
                  <span class="row-detail">
                    {monthLabel(addMonths(current, o.month), { short: true })}
                  </span>
                </div>
              ))}
            </Section>
          )}
          {len > 1 && (
            <Section title="Total owed">
              <LineChart
                title="Total debt remaining each month, avalanche vs snowball"
                dates={idx.map((i) => `${addMonths(current, i)}-01`)}
                labels={idx.map((i) =>
                  monthLabel(addMonths(current, i), { short: true }),
                )}
                series={
                  same
                    ? [
                        {
                          name: "Owed",
                          color: "var(--chart-1)",
                          values: idx.map((i) => at(av.remaining, i)),
                        },
                      ]
                    : [
                        {
                          name: "Avalanche",
                          color: "var(--chart-1)",
                          values: idx.map((i) => at(av.remaining, i)),
                        },
                        {
                          name: "Snowball",
                          color: "var(--chart-2)",
                          values: idx.map((i) => at(sb.remaining, i)),
                        },
                      ]
                }
              />
            </Section>
          )}
        </>
      ) : (
        <p class="plan-note">
          {rows.length
            ? "Enter a balance and minimum payment for each debt."
            : "No credit card or loan balances. Add one below to try it out."}
        </p>
      )}

      <Section
        title="Extra each month"
        footer="Anything above the minimums. It goes to the target debt, and each paid-off debt's minimum rolls into the next."
      >
        <MoneyField label="Extra" value={extraText} set={setExtra} />
      </Section>

      {rows.map((r) => (
        <Section
          title={
            <>
              <span>{r.name || "Debt"}</span>
              <button
                type="button"
                class="link"
                onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              >
                Remove
              </button>
            </>
          }
          footer={
            r.typical
              ? "Rate or minimum is a typical guess. Set the real ones on the account for an accurate plan."
              : undefined
          }
        >
          {r.id.startsWith("new:") && (
            <Field label="Name">
              <input
                value={r.name}
                placeholder="e.g. Car loan"
                onInput={onText(r.id, "name")}
              />
            </Field>
          )}
          <MoneyField
            label="Balance"
            value={r.balance}
            set={(v) => update(r.id, { balance: v })}
          />
          <Field label="APR">
            <input
              inputMode="decimal"
              value={r.apr}
              onInput={onText(r.id, "apr")}
              aria-label={`${r.name} APR`}
            />
            <span class="affix">%</span>
          </Field>
          <MoneyField
            label="Minimum / mo"
            value={r.min}
            set={(v) => update(r.id, { min: v })}
          />
        </Section>
      ))}
      <Section footer={DISCLAIMER}>
        <button
          type="button"
          class="row link-row"
          onClick={() =>
            setRows([
              ...rows,
              {
                id: `new:${newId()}`,
                name: "",
                balance: "",
                apr: "",
                min: "",
                typical: false,
              },
            ])
          }
        >
          Add a Debt
        </button>
      </Section>
    </Sheet>
  );
}
