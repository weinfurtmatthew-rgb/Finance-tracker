import type { Category } from '../types';

export const UNCATEGORIZED = 'uncategorized';
export const TRANSFER = 'transfer';
/** Paying off a credit card: not spending (the purchases already were), not income. */
export const CARD_PAYMENT = 'card-payment';

const c = (id: string, name: string, emoji: string, color: string, group: Category['group'], order: number): Category => ({
  id, name, emoji, color, group, order,
});

export const DEFAULT_CATEGORIES: Category[] = [
  c('income', 'Income', '💵', '#34c759', 'income', 0),
  c('interest', 'Interest & Dividends', '📈', '#30b0c7', 'income', 1),
  c('groceries', 'Groceries', '🛒', '#34c759', 'expense', 10),
  c('dining', 'Dining', '🍽️', '#ff9500', 'expense', 11),
  c('gas', 'Gas', '⛽', '#ff3b30', 'expense', 12),
  c('transport', 'Transportation', '🚗', '#5856d6', 'expense', 13),
  c('shopping', 'Shopping', '🛍️', '#af52de', 'expense', 14),
  c('bills', 'Bills & Utilities', '💡', '#ffcc00', 'expense', 15),
  c('housing', 'Rent & Mortgage', '🏠', '#a2845e', 'expense', 16),
  c('subscriptions', 'Subscriptions', '🔁', '#007aff', 'expense', 17),
  c('entertainment', 'Entertainment', '🎬', '#ff2d55', 'expense', 18),
  c('health', 'Health', '🩺', '#ff6482', 'expense', 19),
  c('travel', 'Travel', '✈️', '#32ade6', 'expense', 20),
  c('personal', 'Personal Care', '💇', '#bf5af2', 'expense', 21),
  c('education', 'Education', '🎓', '#5e5ce6', 'expense', 22),
  c('gifts', 'Gifts & Donations', '🎁', '#ff375f', 'expense', 23),
  c('insurance', 'Insurance', '🛡️', '#64d2ff', 'expense', 24),
  c('fees', 'Fees & Interest', '🧾', '#8e8e93', 'expense', 25),
  c('other', 'Other', '📦', '#8e8e93', 'expense', 26),
  c(UNCATEGORIZED, 'Uncategorized', '❔', '#c7c7cc', 'expense', 27),
  c(CARD_PAYMENT, 'Credit Card Payment', '💳', '#8e8e93', 'transfer', 29),
  c(TRANSFER, 'Transfer', '🔄', '#8e8e93', 'transfer', 30),
  c('investments', 'Investments', '📊', '#30b0c7', 'transfer', 31),
];

/** Categories that should not count as spending or income (card payments, moving your own money around). */
export function isTransferGroup(cat: Pick<Category, 'group'> | undefined): boolean {
  return cat?.group === 'transfer';
}
