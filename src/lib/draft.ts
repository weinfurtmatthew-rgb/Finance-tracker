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
  /** A clean store name from the file (Rocket Money's), used instead of cleaning up the description. */
  payeeHint?: string;
  /** Which account the row is from, in files covering several accounts (Rocket Money). */
  sourceAccount?: SourceAccount;
  /** Payment-app details (Venmo, Cash App). */
  p2p?: DraftP2P;
}

export interface SourceAccount {
  /** Stable key for grouping rows: institution + name + number. */
  key: string;
  /** "Citizens · Checking ••4821". */
  label: string;
  name: string;
  institution?: string;
  last4?: string;
  /** The file's own account type text ("Checking", "Credit Card"). */
  type?: string;
}
