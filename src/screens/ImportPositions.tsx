/**
 * Importing a brokerage's positions file into an investment account (see lib/positions.ts): what it
 * holds, as of a day, matched to what the account has.
 */
import { useState } from 'preact/hooks';
import { db, newId } from '../db';
import { useNav } from '../nav';
import type { Account, ISODate } from '../types';
import { useHoldings, useSecurities } from '../portfolioModel';
import { planImport, readPositions, type PlannedChange, type PositionsFile } from '../lib/positions';
import { formatShares } from '../lib/holdings';
import { formatDate, todayISO } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { Field, Row, Section, Sheet, Toggle } from '../components/ui';

const whole = (c: number) => formatMoney(c, { whole: true });

/** The row that opens a positions file. */
export function ImportPositionsRow(props: { account: Account }) {
  const nav = useNav();
  const pick = async (file: File) => {
    const parsed = readPositions(await file.text());
    if (!parsed) {
      nav.toast('That file doesn’t list positions');
      return;
    }
    nav.present((close) => <ImportPositionsSheet account={props.account} file={parsed} onClose={close} />);
  };
  return (
    <label class="row link-row">
      <span class="row-main">
        <span class="row-title">Import Positions from Your Brokerage…</span>
      </span>
      <input
        type="file"
        class="hidden-file"
        accept=".csv,text/csv"
        aria-label="Import positions from your brokerage"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void pick(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />
    </label>
  );
}

function changeLine(c: PlannedChange): string {
  const n = formatShares;
  switch (c.change) {
    case 'new':
      return `new: ${n(c.now)} shares, ${whole(c.trade!.amount)}`;
    case 'more':
      return `${n(c.was)} → ${n(c.now)} shares: buys ${n(c.now - c.was)}`;
    case 'fewer':
      return `${n(c.was)} → ${n(c.now)} shares: sells ${n(c.was - c.now)}`;
    case 'gone':
      return 'not in the file: sold';
    case 'same':
      return `${n(c.now)} shares, the same`;
    default:
      return 'its shares aren’t known here, so it’s left as it is: add them to its buys, or delete it and import again';
  }
}

export function ImportPositionsSheet(props: { account: Account; file: PositionsFile; onClose: () => void }) {
  const nav = useNav();
  const { account: a, file } = props;
  const hs = useHoldings().get(a.id);
  const securities = useSecurities();
  // Several accounts in one file (Fidelity): this one's, by its last 4 digits when they match.
  const several = file.accounts.length > 1;
  const [from, setFrom] = useState(() =>
    several ? (file.accounts.find((x) => a.last4 && x.endsWith(a.last4)) ?? file.accounts[0]) : (file.accounts[0] ?? ''),
  );
  const [asOf, setAsOf] = useState<ISODate>(file.asOf ?? todayISO());
  const [sellMissing, setSellMissing] = useState(true);
  const rows = file.rows.filter((r) => !several || r.account === from);
  const cash = file.cash.get(from);
  const missing = !!hs?.positions.some((p) => p.value > 0 && !rows.some((r) => r.ticker === p.ticker));
  const plan = planImport(rows, a.id, hs, asOf, sellMissing);
  const trades = plan.filter((c) => c.trade);
  const valid = !!asOf && asOf <= todayISO() && (trades.length > 0 || cash != null);

  const save = async () => {
    if (!valid) return;
    // After every trade already here, so a sale on the same day comes after the buy it sells.
    const last = Math.max(0, ...(hs?.positions.flatMap((p) => p.trades.map((t) => t.createdAt)) ?? []));
    const now = Math.max(Date.now(), last + 1);
    await db.transaction('rw', [db.trades, db.securities, db.accounts], async () => {
      await db.trades.bulkAdd(trades.map((c, i) => ({ ...c.trade!, id: newId(), createdAt: now + i })));
      for (const r of rows)
        if (!securities.has(r.ticker) && !(await db.securities.get(r.ticker))) await db.securities.put({ ticker: r.ticker, name: r.name || r.ticker });
      if (cash != null) await db.accounts.update(a.id, { cash: { amount: cash, date: asOf } });
    });
    nav.toast(`Imported ${rows.length} position${rows.length === 1 ? '' : 's'}`);
    props.onClose();
  };

  return (
    <Sheet title="Import Positions" onClose={props.onClose} onSave={save} saveLabel="Import" saveDisabled={!valid}>
      <Section
        footer={`From ${file.format === 'Positions' ? 'your brokerage' : file.format}. New holdings start at their value that day${
          rows.some((r) => r.basis) ? ' and keep their cost basis for your gain' : ''
        }; if you have one already, the difference is bought or sold.`}
      >
        {several && (
          <Field label="From">
            <select value={from} onChange={(e) => setFrom((e.target as HTMLSelectElement).value)}>
              {file.accounts.map((x) => (
                <option value={x}>{x || 'Account'}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="As of" hint={file.asOf ? 'The day the file is from' : 'The day you downloaded it'}>
          <input type="date" value={asOf} max={todayISO()} onInput={(e) => setAsOf((e.target as HTMLInputElement).value)} />
        </Field>
      </Section>
      <Section title={`Into ${a.name}`}>
        {plan.map((c) => (
          <Row title={c.ticker} subtitle={changeLine(c)} detail={c.trade ? whole(c.trade.amount) : undefined} chevron={false} />
        ))}
        {cash != null && <Row title="Cash" subtitle={`as of ${formatDate(asOf)}`} detail={whole(cash)} chevron={false} />}
        {missing && <Toggle label="Sell what isn’t in the file" checked={sellMissing} onChange={setSellMissing} />}
      </Section>
    </Sheet>
  );
}
