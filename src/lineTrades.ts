/**
 * Puts the purchases and sales read from bank file lines (lib/bankTrades.ts) into accounts' holdings. Call
 * these inside a database transaction over trades, securities and transactions (and meta, for an import),
 * or on their own.
 */
import { db, getMeta, newId } from './db';
import type { Account, Trade, Transaction } from './types';
import { importedTrades, LINE_TICKERS, tradeFor, tradesText, type Line } from './lib/bankTrades';
import { cleanPayee, merchantName } from './lib/payee';

/** Adds the lines' trades, names each stock that's new to the app, and tidies the lines' names ("Bought FXAIX"). */
export async function addLineTrades(lines: (Line & { ticker: string })[]): Promise<Trade[]> {
  const now = Date.now();
  const trades = lines.map((l, i) => tradeFor(l, newId(), now + i));
  await db.trades.bulkAdd(trades);
  for (const ticker of new Set(trades.map((t) => t.ticker))) {
    if (!(await db.securities.get(ticker))) await db.securities.put({ ticker, name: lines.find((l) => l.ticker === ticker && l.name)?.name ?? ticker });
  }
  // Lines imported before brokerage lines were read kept a cut-off name ("You Bought Prospectus Under
  // Separate Cover Fidelity"): the one that says what it bought, unless you'd named it yourself.
  for (const l of lines) {
    const changes: Partial<Transaction> = {};
    const tidy = cleanPayee(l.txn.description);
    if (tidy !== l.txn.payee && l.txn.payee === merchantName(l.txn.description)) changes.payee = tidy;
    // One you'd kept out is in now.
    if (l.txn.noTrade) changes.noTrade = undefined;
    if (Object.keys(changes).length) await db.transactions.update(l.txn.id, changes);
  }
  return trades;
}

const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * After an import: the trades in the lines it added (`added`) that go straight into holdings, and the ones
 * that wait for you, with a sentence on each for the Done screen.
 */
export async function tradesForImport(added: Set<string>): Promise<{ add: Line[]; waiting: Line[]; unheld: Line[]; notes: ImportNotes }> {
  const [accounts, txns, trades, picked] = await Promise.all([
    db.accounts.toArray(),
    db.transactions.toArray(),
    db.trades.toArray(),
    getMeta<Record<string, string>>(LINE_TICKERS),
  ]);
  const { add, waiting, unheld } = importedTrades({ accounts, txns, trades, added, picked: picked ?? {} });
  await addLineTrades(add);
  return { add, waiting, unheld, notes: importNotes(add, waiting, unheld, accounts) };
}

/** The Done screen's sentences: what went into holdings, what waits for you, and sales of shares bought before your files. */
export interface ImportNotes {
  added?: string;
  waiting?: string;
  unheld?: string;
}

function importNotes(add: Line[], waiting: Line[], unheld: Line[], accounts: Account[]): ImportNotes {
  const where = (lines: Line[]) => {
    const ids = [...new Set(lines.map((l) => l.txn.accountId))];
    return {
      holdings: `${ids.length === 1 ? possessive(accounts.find((a) => a.id === ids[0])?.name ?? 'the account') : 'their accounts’'} holdings`,
      one: ids.length === 1,
    };
  };
  const notes: ImportNotes = {};
  if (add.length) notes.added = `${cap(tradesText(add))} also went into ${where(add).holdings}.`;
  if (waiting.length) {
    const w = where(waiting);
    notes.waiting = `${cap(tradesText(waiting))} can go into ${w.holdings}: open ${w.one ? 'the account' : 'each account'} in Net Worth to add ${waiting.length === 1 ? 'it' : 'them'}.`;
  }
  if (unheld.length) {
    const one = unheld.length === 1;
    notes.unheld = `${cap(tradesText(unheld))} ${one ? 'is' : 'are'} of shares bought before your files start: open the account in Net Worth to add when you bought them, and ${
      one ? 'it goes' : 'they go'
    } in with ${one ? 'its' : 'their'} gain.`;
  }
  return notes;
}

/** The lines of trades you deleted stay out of the holdings, rather than being offered again. */
export async function keepOutLines(trades: Trade[]): Promise<void> {
  const ids = trades.map((t) => t.txnId).filter((x): x is string => !!x);
  if (ids.length) await db.transactions.bulkUpdate(ids.map((key) => ({ key, changes: { noTrade: true } })));
}

/** Lines moved to another account or day (or their amount put right): their trades go with them. */
export async function moveLineTrades(updates: { id: string; changes: Partial<Transaction> }[]): Promise<void> {
  const byLine = new Map(updates.filter((u) => u.changes.accountId || u.changes.date || u.changes.amount != null).map((u) => [u.id, u.changes]));
  if (!byLine.size) return;
  for (const t of await db.trades.filter((x) => !!x.txnId && byLine.has(x.txnId)).toArray()) {
    const c = byLine.get(t.txnId!)!;
    await db.trades.update(t.id, {
      ...(c.accountId ? { accountId: c.accountId } : {}),
      ...(c.date ? { date: c.date } : {}),
      ...(c.amount != null ? { amount: Math.abs(c.amount) } : {}),
    });
  }
}
