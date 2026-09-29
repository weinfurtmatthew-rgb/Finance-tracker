import type { Category } from '../types';

export const UNCATEGORIZED = 'uncategorized';
export const TRANSFER = 'transfer';
/** Paying off a credit card: not spending (the purchases already were), not income. */
export const CARD_PAYMENT = 'card-payment';
/** Money you paid for someone else (and their repayment): not your spending, not income. */
export const OWED = 'owed';

const c = (id: string, name: string, emoji: string, color: string, group: Category['group'], order: number): Category => ({
  id, name, emoji, color, group, order,
});

export const DEFAULT_CATEGORIES: Category[] = [
  c('income', 'Income', '💵', '#34c759', 'income', 0),
  c('interest', 'Interest & Dividends', '📈', '#30b0c7', 'income', 1),
  c('groceries', 'Groceries', '🛒', '#34c759', 'expense', 10),
  c('dining', 'Dining', '🍽️', '#ff9500', 'expense', 11),
  c('coffee', 'Coffee', '☕', '#a2845e', 'expense', 11.3),
  c('alcohol', 'Alcohol & Bars', '🍺', '#ff9f0a', 'expense', 11.6),
  c('gas', 'Gas', '⛽', '#ff3b30', 'expense', 12),
  c('transport', 'Transportation', '🚗', '#5856d6', 'expense', 13),
  c('car-payment', 'Car Payment', '🚙', '#5e5ce6', 'expense', 13.3),
  c('car-maintenance', 'Car Maintenance', '🔧', '#8e8e93', 'expense', 13.6),
  c('shopping', 'Shopping', '🛍️', '#af52de', 'expense', 14),
  c('clothing', 'Clothing', '👕', '#bf5af2', 'expense', 14.2),
  c('electronics', 'Electronics', '📱', '#64d2ff', 'expense', 14.4),
  c('home', 'Home & Garden', '🔨', '#a2845e', 'expense', 14.6),
  c('bills', 'Bills & Utilities', '💡', '#ffcc00', 'expense', 15),
  c('housing', 'Rent & Mortgage', '🏠', '#a2845e', 'expense', 16),
  c('subscriptions', 'Subscriptions', '🔁', '#007aff', 'expense', 17),
  c('entertainment', 'Entertainment', '🎬', '#ff2d55', 'expense', 18),
  c('health', 'Health', '🩺', '#ff6482', 'expense', 19),
  c('fitness', 'Fitness', '🏋️', '#30d158', 'expense', 19.5),
  c('travel', 'Travel', '✈️', '#32ade6', 'expense', 20),
  c('personal', 'Personal Care', '💇', '#bf5af2', 'expense', 21),
  c('pets', 'Pets', '🐾', '#ff9f0a', 'expense', 21.3),
  c('kids', 'Kids', '🧸', '#ff375f', 'expense', 21.6),
  c('education', 'Education', '🎓', '#5e5ce6', 'expense', 22),
  c('gifts', 'Gifts', '🎁', '#ff375f', 'expense', 23),
  c('charity', 'Charity', '💝', '#ff2d55', 'expense', 23.5),
  c('insurance', 'Insurance', '🛡️', '#64d2ff', 'expense', 24),
  c('taxes', 'Taxes', '🏛️', '#8e8e93', 'expense', 24.5),
  c('fees', 'Fees & Interest', '🧾', '#8e8e93', 'expense', 25),
  c('other', 'Other', '📦', '#8e8e93', 'expense', 26),
  c(UNCATEGORIZED, 'Uncategorized', '❔', '#c7c7cc', 'expense', 27),
  c(CARD_PAYMENT, 'Credit Card Payment', '💳', '#8e8e93', 'transfer', 29),
  c(TRANSFER, 'Transfer', '🔄', '#8e8e93', 'transfer', 30),
  c('investments', 'Investments', '📊', '#30b0c7', 'transfer', 31),
  c(OWED, 'Owed to Me', '🤝', '#8e8e93', 'transfer', 32),
];

/** Built-in categories added in v6 (added to existing databases on upgrade). */
export const ADDED_IN_V6 = ['coffee', 'alcohol', 'car-payment', 'car-maintenance', 'clothing', 'electronics', 'home', 'fitness', 'pets', 'kids', 'charity', 'taxes', OWED];

/** Categories that should not count as spending or income (card payments, moving your own money around). */
export function isTransferGroup(cat: Pick<Category, 'group'> | undefined): boolean {
  return cat?.group === 'transfer';
}
