import type { Cents, ISODate } from '../types';
import type { DraftP2P } from './p2p';

/** A transaction read from a file, before it is categorized and saved. */
export interface DraftTransaction {
  date: ISODate;
  amount: Cents;
  description: string;
  bankCategory?: string;
  /** OFX's unique transaction id, when the file provides one. */
  fitid?: string;
  /** Payment-app details (Venmo, Cash App). */
  p2p?: DraftP2P;
}
