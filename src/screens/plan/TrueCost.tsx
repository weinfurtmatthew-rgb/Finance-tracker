import { useState } from 'preact/hooks';
import { Section, Segmented, Sheet } from '../../components/ui';
import { DEFAULT_RETURN, trueCost } from '../../lib/plan';
import type { PlanData } from '../../planModel';
import { Answer, DISCLAIMER, MoneyField, PercentField, money, pct, useMoney, usePercent } from './common';

type Per = 'week' | 'month' | 'year';
const PER_MONTH: Record<Per, number> = {
  week: 52 / 12,
  month: 1,
  year: 1 / 12,
};

/** What a habit or subscription really costs over the years, and what it could grow to if invested. */
export function TrueCostCalc(props: { data: PlanData; onClose: () => void }) {
  const habits = props.data.habits;
  const [picked, setPicked] = useState(habits[0]?.key ?? '');
  const [amount, amountText, setAmount] = useMoney(habits[0]?.monthly ?? 0);
  const [per, setPer] = useState<Per>('month');
  const [rate, rateText, setRate] = usePercent(DEFAULT_RETURN);
  const monthly = Math.round(amount * PER_MONTH[per]);
  const rows = trueCost(monthly, rate, [1, 5, 10, 20, 30]);
  const ten = rows[2];
  const name = habits.find((h) => h.key === picked)?.name;

  const choose = (key: string) => {
    const h = habits.find((x) => x.key === key);
    setPicked(key);
    if (h) {
      setPer('month');
      setAmount(String(Math.round(h.monthly / 100)));
    }
  };

  return (
    <Sheet title="True Cost" onClose={props.onClose}>
      {monthly > 0 && (
        <Answer
          label={`${name ?? 'This habit'} over 10 years`}
          value={money(ten.spent)}
          sub={`or ${money(ten.invested)} if you invested ${money(monthly)} a month instead at ${pct(rate)}`}
        />
      )}
      {habits.length > 0 && (
        <Section title="Pick from your spending">
          <label class="field">
            <span class="field-label">Habit</span>
            <span class="field-control">
              <select value={picked} onChange={(e) => choose((e.target as HTMLSelectElement).value)} aria-label="Habit">
                <optgroup label="Subscriptions">
                  {habits
                    .filter((h) => h.kind !== 'merchant')
                    .map((h) => (
                      <option value={h.key}>
                        {h.name} · {money(h.monthly)}/mo
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Places you go often">
                  {habits
                    .filter((h) => h.kind === 'merchant')
                    .map((h) => (
                      <option value={h.key}>
                        {h.name} · {money(h.monthly)}/mo
                      </option>
                    ))}
                </optgroup>
                <option value="">Something else…</option>
              </select>
            </span>
          </label>
        </Section>
      )}
      <Section title="Cost">
        <MoneyField label="Amount" value={amountText} set={(v) => (setAmount(v), setPicked(''))} />
      </Section>
      <Segmented
        value={per}
        onChange={(p) => (setPer(p), setPicked(''))}
        options={[
          { value: 'week', label: 'Per week' },
          { value: 'month', label: 'Per month' },
          { value: 'year', label: 'Per year' },
        ]}
      />
      {monthly > 0 && (
        <Section title="Over time" footer={`“If invested” assumes ${pct(rate)} a year, compounded monthly, before inflation.`}>
          <div class="row plan-table-head">
            <span class="row-main">Years</span>
            <span class="row-detail">Spent</span>
            <span class="row-detail">If invested</span>
          </div>
          {rows.map((r) => (
            <div class="row">
              <span class="row-main">
                <span class="row-title">
                  {r.years} year{r.years === 1 ? '' : 's'}
                </span>
              </span>
              <span class="row-detail">{money(r.spent)}</span>
              <span class="row-detail strong">{money(r.invested)}</span>
            </div>
          ))}
        </Section>
      )}
      <Section footer={DISCLAIMER}>
        <PercentField label="Return" value={rateText} set={setRate} hint="A long-run stock-market average is about 7% a year before inflation" />
      </Section>
    </Sheet>
  );
}
