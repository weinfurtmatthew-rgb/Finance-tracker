import type { Account, Cents, ISODate, Transaction } from '../types';

export function accountBalance(account: Account, txns: Transaction[], asOf?: ISODate): Cents {
  let total = account.openingBalance;
  for (const t of txns) if (t.accountId === account.id && (!asOf || t.date <= asOf)) total += t.amount;
  return total;
}

/** Opening balance that makes the account's balance equal `balance` on `asOf` (or today). */
export function openingBalanceFor(accountId: string, txns: Transaction[], balance: Cents, asOf?: ISODate): Cents {
  let sum = 0;
  for (const t of txns) if (t.accountId === accountId && (!asOf || t.date <= asOf)) sum += t.amount;
  return balance - sum;
}

export const LIABILITY_TYPES: Account['type'][] = ['credit', 'loan'];

export function isLiability(account: Pick<Account, 'type'>): boolean {
  return LIABILITY_TYPES.includes(account.type);
}
