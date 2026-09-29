/**
 * One-time tidy-up: transactions from before category sources were tracked whose category was only a
 * guess (the bank's catch-all "Other", unknown money-in filed as Income, or nothing at all). Anything
 * you chose or a rule set is left alone.
 */
import type { Account, Rule, Transaction } from '../types';
import { categorize, isTrusted, isWeakCategory } from './categorize';

export function oldGuesses(txns: Transaction[], rules: Rule[], accounts: Account[]): Transaction[] {
  const credit = new Set(accounts.filter((a) => a.type === 'credit').map((a) => a.id));
  return txns.filter((t) => {
    if (isTrusted(t) || t.categorySource === 'ai' || t.categorySource === 'history' || t.categorySource === 'keyword') return false;
    if (isWeakCategory(t) || t.categoryId === 'other') return true;
    if (t.categorySource || t.categoryId !== 'income') return false;
    // Older money-in filed as Income: a guess unless a rule or keyword would still say Income today.
    const again = categorize({ description: t.description, payee: t.payee, amount: t.amount, creditAccount: credit.has(t.accountId) }, rules);
    return again.source === 'default' || again.categoryId !== 'income';
  });
}
