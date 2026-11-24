/**
 * Purchases and sales in an investment account's bank file lines (lib/bankTrades.ts): on the account's
 * page, the ones not in its holdings yet, to add; on a line, how it stands with them.
 */
import { useMemo } from 'preact/hooks';
import { db } from '../db';
import { useAccounts, useMeta, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { Account, Transaction } from '../types';
import { useTrades } from '../portfolioModel';
import { accountLines, LINE_TICKERS, lineKey, positionsDay, tradesText, type Line } from '../lib/bankTrades';
import { canHoldStocks, formatShares } from '../lib/holdings';
import { formatMoney } from '../lib/money';
import { formatShortDate } from '../lib/dates';
import { Row, Section } from '../components/ui';
import { addLineTrades } from '../lineTrades';
import { HoldingSheet, TradeSheet } from './Holdings';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** An investment account's bank file lines that are trades, and how each stands with its holdings. */
function useLines(account: Account | undefined): Line[] {
  const txns = useTransactions();
  const trades = useTrades();
  const picked = useMeta<Record<string, string>>(LINE_TICKERS);
  return useMemo(() => (account && canHoldStocks(account) ? accountLines(account, txns, trades, picked ?? {}) : []), [account, txns, trades, picked]);
}

const addLines = (lines: (Line & { ticker: string })[]) => db.transaction('rw', [db.trades, db.securities, db.transactions], () => addLineTrades(lines));

/** On an investment account's page: purchases and sales in its bank file lines that aren't in its holdings yet. */
export function BankLinesSection(props: { account: Account }) {
  const nav = useNav();
  const a = props.account;
  const tracked = useTrades().some((t) => t.accountId === a.id);
  const lines = useLines(a).filter((l) => l.state === 'missing');
  if (!lines.length) return null;
  const known = lines.filter((l): l is Line & { ticker: string } => !!l.ticker);
  // Lines that don't say their stock, alike ones together: pick it for one and the rest follow.
  const unknown = new Map<string, Line[]>();
  for (const l of lines) {
    if (l.ticker) continue;
    const key = lineKey(l.txn.description);
    unknown.set(key, [...(unknown.get(key) ?? []), l]);
  }
  const first = known[0]?.txn.date;
  const last = known[known.length - 1]?.txn.date;
  const buys = known.every((l) => l.kind === 'buy');
  const add = async () => {
    await addLines(known);
    nav.toast(`${cap(tradesText(known))} added`);
  };
  return (
    <Section
      title="From your bank files"
      footer={[
        `Each goes in on its day for what it cost${known.some((l) => l.shares) ? ', with the shares your file gives' : ''}, as money put into this account${
          buys ? '' : ' (a sale’s money stays in it as cash)'
        }.`,
        tracked
          ? 'New ones in your imports go in on their own.'
          : 'This account’s value then comes from its holdings: if it holds more than these, import a positions file first, and only the ones after its day are added. From then on, new ones in your imports go in on their own.',
      ].join(' ')}
    >
      {known.length > 0 && (
        <>
          <Row
            title={cap(tradesText(known))}
            subtitle={`${first === last ? formatShortDate(first) : `${formatShortDate(first)} – ${formatShortDate(last)}`} · not in its holdings yet`}
            detail={
              buys
                ? formatMoney(
                    known.reduce((s, l) => s + Math.abs(l.txn.amount), 0),
                    { whole: true },
                  )
                : undefined
            }
            chevron={false}
          />
          <button type="button" class="row link-row" onClick={() => void add()}>
            {known.length === 1 ? 'Add It to Holdings' : `Add All ${known.length} to Holdings`}
          </button>
        </>
      )}
      {[...unknown.values()].map((g) => (
        <Row
          title={g[0].txn.payee}
          subtitle={`${cap(tradesText(g))} · doesn’t say which stock`}
          detail="Choose"
          onClick={() => nav.present((close) => <TradeSheet account={a} line={g[0]} onClose={close} />)}
        />
      ))}
    </Section>
  );
}

/** On a bank file line in an investment account: the purchase or sale it is, and how that stands with the holdings. */
export function LineTradeSection(props: { txn: Transaction }) {
  const nav = useNav();
  const account = useAccounts().find((x) => x.id === props.txn.accountId);
  const trades = useTrades();
  const l = useLines(account).find((x) => x.txn.id === props.txn.id);
  if (!l || !account) return null;
  const what = l.ticker ? `${l.kind === 'buy' ? 'Bought' : 'Sold'} ${l.ticker}` : l.kind === 'buy' ? 'A purchase' : 'A sale';
  const shares = l.trade?.shares ?? l.shares;
  const title = shares ? `${what} · ${formatShares(shares)} share${shares === 1 ? '' : 's'}` : what;
  const open = () => nav.present((close) => <HoldingSheet account={account} ticker={l.ticker!} onClose={close} />);
  const choose = () => nav.present((close) => <TradeSheet account={account} line={l} onClose={close} />);
  const add = async () => {
    await addLines([l as Line & { ticker: string }]);
    nav.toast(`${l.ticker} added to holdings`);
  };
  const subtitle = {
    added: 'In this account’s holdings',
    matched: 'In this account’s holdings, as the trade you added',
    counted: `Counted in the positions you imported for ${formatShortDate(positionsDay(account, trades) ?? l.txn.date)}`,
    'kept-out': 'Kept out of this account’s holdings',
    missing: l.ticker ? 'Not in this account’s holdings yet' : 'The line doesn’t say which stock',
  }[l.state];
  const inHoldings = l.state === 'added' || l.state === 'matched';
  return (
    <Section title="Holdings">
      <Row title={title} subtitle={subtitle} onClick={inHoldings ? open : undefined} chevron={inHoldings} />
      {(l.state === 'missing' || l.state === 'kept-out') && (
        <button type="button" class="row link-row" onClick={l.ticker ? () => void add() : choose}>
          {l.ticker ? 'Add to Holdings' : 'Choose the Stock'}
        </button>
      )}
    </Section>
  );
}
