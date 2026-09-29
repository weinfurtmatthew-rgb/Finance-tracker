/** Decode the jargon in bank descriptions ("TST* BLUE DR 0442", "SQ *", "AMZN Mktp") without guessing. */
import { cleanPayee } from '../lib/payee';
import { keywordCategory } from '../lib/categorize';

const CODES: [RegExp, string][] = [
  [/\bTST\s?\*/i, 'TST* = paid through Toast, a restaurant payment system: almost always a restaurant, café or bar'],
  [/\bSQ\s?\*|\bSQC\*/i, 'SQ* = paid through Square, used by small shops, cafés and service businesses'],
  [/\bPP\s?\*|\bPAYPAL\s?\*/i, 'PP*/PAYPAL* = paid through PayPal; the merchant name follows'],
  [/\bAMZN\s+MKTP|\bAMAZON\s+MKTPL/i, 'AMZN Mktp = an Amazon Marketplace order'],
  [/\bAMZN\s+DIGITAL|\bKINDLE/i, 'Amazon digital purchase (Kindle, Prime Video, apps)'],
  [/\bPRIME\s*VIDEO|\bAMAZON\s+PRIME|\bPRIME\s+MEMBER/i, 'Amazon Prime membership or Prime Video'],
  [/APPLE\.COM\/BILL|\bITUNES/i, 'APPLE.COM/BILL = an Apple subscription (iCloud, Apple Music, apps) or App Store purchase'],
  [/\bGOOGLE\s?\*/i, 'GOOGLE* = a Google purchase (Play Store, Google One, YouTube) '],
  [/\bSP\s+\S|\bSHOPIFY/i, 'SP = an online store running on Shopify'],
  [/\bDD\s?\*|DOORDASH/i, 'DoorDash food delivery'],
  [/UBER\s*\*?\s*EATS/i, 'Uber Eats food delivery'],
  [/\bUBER\s*\*?\s*TRIP|\bUBER\b/i, 'Uber ride'],
  [/\bLYFT/i, 'Lyft ride'],
  [/\bIN \*/i, 'IN* = paid through an invoicing service (often a local business)'],
  [/\bBT\s?\*/i, 'BT* = paid through Braintree (online checkout)'],
  [/\bCKO\s?\*|\bCHECKOUT\.COM/i, 'Paid through Checkout.com (online checkout)'],
  [/\bCHECKCARD|\bDBT\s+CRD|\bDEBIT CARD|\bPOS\b/i, 'Debit card purchase (POS = point of sale)'],
  [/\bACH\b/i, 'ACH = an electronic bank transfer'],
  [/\bXFER\b|\bTRANSFER\b/i, 'A transfer between accounts'],
  [/\bZELLE/i, 'Zelle payment to or from a person'],
  [/\bVENMO/i, 'Venmo payment to or from a person'],
  [/\bCASH\s*APP|\bSQC\*/i, 'Cash App payment'],
  [/\bPMNT|\bPYMT|\bPMT\b/i, 'PYMT/PMNT = payment'],
  [/\bRECURRING\b|\bAUTOPAY\b/i, 'A recurring or automatic payment'],
  [/\bINTL\b|\bFOREIGN\b|\bFX\b/i, 'An international purchase (may include a foreign transaction fee)'],
  [/\b(ATM|WITHDRAWAL|WDRL)\b/i, 'Cash withdrawal'],
  [/\bINT(EREST)?\s+(PAID|EARNED|CHARGE)/i, 'Interest paid or charged'],
];

export interface Explanation {
  notes: string[];
  suggestedName: string;
  categoryId?: string;
}

export function explainDescription(description: string, amount: number): Explanation {
  const notes = CODES.filter(([re]) => re.test(description)).map(([, n]) => n.trim());
  if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(description)) notes.push('The 10-digit number is the company’s phone number');
  else if (/#\s?\d+|\b\d{4,}\b/.test(description)) notes.push('The trailing numbers are usually a store number or reference code');
  if (/\b[A-Z]{2}\s*$/.test(description.trim())) notes.push('The two letters at the end are the state');
  return { notes, suggestedName: cleanPayee(description), categoryId: keywordCategory(description, amount) ?? undefined };
}
