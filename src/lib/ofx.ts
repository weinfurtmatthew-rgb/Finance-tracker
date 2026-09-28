import type { Cents, ISODate } from '../types';
import type { DraftTransaction } from './draft';
import { parseBankDate } from './dates';
import { parseAmount } from './money';

/** One account statement inside an OFX / QFX / QBO file. */
export interface OfxStatement {
  kind: 'bank' | 'credit';
  /** Account number as given by the bank (we only ever show the last 4 digits). */
  accountNumber?: string;
  /** CHECKING, SAVINGS, MONEYMRKT, CREDITLINE, ... for bank statements. */
  bankAccountType?: string;
  balance?: { amount: Cents; asOf: ISODate };
  transactions: DraftTransaction[];
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

/** Value of a leaf element. Works for SGML OFX 1.x (no closing tags) and XML OFX 2.x. */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  const v = m ? decode(m[1]) : '';
  return v || undefined;
}

function blocks(text: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

export function looksLikeOfx(text: string): boolean {
  return /<OFX>/i.test(text) || /OFXHEADER/i.test(text.slice(0, 500));
}

export function parseOfx(text: string): OfxStatement[] {
  const statements: OfxStatement[] = [];
  const kinds: [string, OfxStatement['kind']][] = [
    ['STMTRS', 'bank'],
    ['CCSTMTRS', 'credit'],
  ];
  for (const [aggregate, kind] of kinds) {
    for (const stmt of blocks(text, aggregate)) {
      const transactions: DraftTransaction[] = [];
      for (const t of blocks(stmt, 'STMTTRN')) {
        const date = parseBankDate(tag(t, 'DTPOSTED') ?? tag(t, 'DTUSER'));
        const amount = parseAmount(tag(t, 'TRNAMT'));
        if (!date || amount == null) continue;
        const name = tag(t, 'NAME') ?? '';
        const memo = tag(t, 'MEMO') ?? '';
        let description = name || memo || tag(t, 'TRNTYPE') || '(no description)';
        // NAME is often truncated to 32 characters; keep MEMO for search, separated so payee cleanup ignores it.
        if (name && memo && !name.toLowerCase().includes(memo.toLowerCase())) description = `${name}  ${memo}`;
        transactions.push({ date, amount, description, fitid: tag(t, 'FITID') });
      }
      const ledger = blocks(stmt, 'LEDGERBAL')[0];
      const balAmount = ledger ? parseAmount(tag(ledger, 'BALAMT')) : null;
      const balDate = ledger ? parseBankDate(tag(ledger, 'DTASOF')) : null;
      statements.push({
        kind,
        accountNumber: tag(stmt, 'ACCTID'),
        bankAccountType: kind === 'bank' ? tag(stmt, 'ACCTTYPE') : undefined,
        balance: balAmount != null && balDate ? { amount: balAmount, asOf: balDate } : undefined,
        transactions,
      });
    }
  }
  return statements;
}
