import type { Cents, ISODate } from '../types';

/** A transaction read from a file, before it is categorized and saved. */
export interface DraftTransaction {
  date: ISODate;
  amount: Cents;
  description: string;
  bankCategory?: string;
  /** OFX's unique transaction id, when the file provides one. */
  fitid?: string;
}
