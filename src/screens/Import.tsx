import { useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '../db';
import { useNav } from '../nav';
import type { Account, AccountType, CsvMapping, TransactionSource } from '../types';
import type { DraftTransaction } from '../lib/draft';
import { csvToDrafts, detectFormat, headerSignature, readCsv, type CsvTable } from '../lib/csv';
import { looksLikeOfx, parseOfx, type OfxStatement } from '../lib/ofx';
import { prepareImport, toTransactions } from '../lib/importer';
import { openingBalanceFor } from '../lib/balances';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { CategoryIcon, Empty, Field, Money, Section, Sheet, Toggle } from '../components/ui';
import { ACCOUNT_TYPES, AccountEditor } from './AccountEditor';

interface CsvState {
  kind: 'csv';
  table: CsvTable;
  format: string;
  note?: string;
  mapping: CsvMapping;
  saved: boolean;
}

interface OfxState {
  kind: 'ofx';
  statements: OfxStatement[];
  index: number;
}

type Parsed = (CsvState | OfxState) & { fileName: string };

const NEW = '__new__';

function guessAccountType(format: string, ofx?: OfxStatement): AccountType {
  if (ofx) {
    if (ofx.kind === 'credit') return 'credit';
    const t = ofx.bankAccountType?.toUpperCase();
    return t === 'SAVINGS' || t === 'MONEYMRKT' ? 'savings' : t === 'CREDITLINE' ? 'credit' : 'checking';
  }
  if (/discover|capital one \(card\)/i.test(format)) return 'credit';
  if (/fidelity/i.test(format)) return 'brokerage';
  return 'checking';
}

function guessInstitution(format: string, fileName: string): string {
  for (const bank of ['Citizens', 'Discover', 'Capital One', 'Fidelity']) {
    if (format.toLowerCase().includes(bank.toLowerCase()) || fileName.toLowerCase().replace(/[_-]/g, ' ').includes(bank.toLowerCase())) return bank;
  }
  return '';
}

export function ImportFlow(props: { onClose: () => void; accountId?: string }) {
  const nav = useNav();
  const accounts = useLiveQuery(() => db.accounts.toArray(), []);
  const rules = useLiveQuery(() => db.rules.toArray(), []);
  const categories = useLiveQuery(() => db.categories.toArray(), []);
  const [parsed, setParsed] = useState<Parsed>();
  const [error, setError] = useState<string>();
  const [accountId, setAccountId] = useState<string>(props.accountId ?? NEW);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('checking');
  const [newInstitution, setNewInstitution] = useState('');
  const [useBalance, setUseBalance] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; skipped: number; account: Account; balanceSet: boolean }>();

  const existingIds = useLiveQuery(async () => {
    if (accountId === NEW) return new Set<string>();
    const txns = await db.transactions.where('accountId').equals(accountId).toArray();
    return new Set(txns.map((t) => t.importId).filter((x): x is string => !!x));
  }, [accountId]);

  const onFile = async (file: File) => {
    setError(undefined);
    try {
      const text = await file.text();
      const ofxLike = /\.(ofx|qfx|qbo)$/i.test(file.name) || looksLikeOfx(text);
      let nextAccount = props.accountId;
      if (ofxLike) {
        const statements = parseOfx(text);
        if (!statements.length) throw new Error('No account statement was found in this file.');
        const st = statements[0];
        setParsed({ kind: 'ofx', statements, index: 0, fileName: file.name });
        const last4 = st.accountNumber?.replace(/\D/g, '').slice(-4);
        nextAccount ??= accounts?.find((a) => last4 && a.last4 === last4)?.id;
        setNewType(guessAccountType('', st));
        setNewInstitution(guessInstitution('', file.name));
        setNewName(`${guessInstitution('', file.name) || 'Bank'} ${ACCOUNT_TYPES.find((t) => t.value === guessAccountType('', st))?.label ?? ''}`.trim());
      } else {
        const table = readCsv(text);
        if (table.headerIndex < 0) throw new Error("This doesn't look like a transactions file.");
        const saved = await db.csvMappings.get(headerSignature(table.headers));
        const detected = detectFormat(table, accounts?.find((a) => a.id === (nextAccount ?? saved?.accountId))?.type);
        setParsed({
          kind: 'csv',
          table,
          format: detected.format,
          note: detected.note,
          mapping: saved ?? detected.mapping,
          saved: !!saved,
          fileName: file.name,
        });
        nextAccount ??= saved?.accountId && accounts?.some((a) => a.id === saved.accountId) ? saved.accountId : undefined;
        const inst = guessInstitution(detected.format, file.name);
        const type = guessAccountType(detected.format);
        setNewType(type);
        setNewInstitution(inst);
        setNewName(`${inst || 'New'} ${ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? ''}`.trim());
      }
      setAccountId(nextAccount ?? NEW);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const statement = parsed?.kind === 'ofx' ? parsed.statements[parsed.index] : undefined;
  const read = useMemo((): { drafts: DraftTransaction[]; skipped: number } => {
    if (!parsed) return { drafts: [], skipped: 0 };
    if (parsed.kind === 'ofx') return { drafts: parsed.statements[parsed.index].transactions, skipped: 0 };
    return csvToDrafts(parsed.table, parsed.mapping);
  }, [parsed]);

  const prepared = useMemo(
    () => (existingIds && rules ? prepareImport(accountId, read.drafts, existingIds, rules) : []),
    [read, existingIds, rules, accountId],
  );
  const fresh = prepared.filter((p) => !p.duplicate);
  const dupes = prepared.length - fresh.length;
  const cats = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const dates = read.drafts.map((d) => d.date).sort();

  const commit = async () => {
    if (!parsed || !rules) return;
    setBusy(true);
    try {
      const source: TransactionSource = parsed.kind;
      const result = await db.transaction('rw', [db.accounts, db.transactions, db.csvMappings], async () => {
        let account = accountId === NEW ? undefined : await db.accounts.get(accountId);
        if (!account) {
          const last4 = statement?.accountNumber?.replace(/\D/g, '').slice(-4);
          account = {
            id: newId(),
            name: newName.trim() || 'New account',
            type: newType,
            institution: newInstitution.trim(),
            last4: last4 || undefined,
            openingBalance: 0,
            archived: false,
            createdAt: Date.now(),
          };
          await db.accounts.add(account);
        }
        const existing = await db.transactions.where('accountId').equals(account.id).toArray();
        const ids = new Set(existing.map((t) => t.importId).filter((x): x is string => !!x));
        const items = prepareImport(account.id, read.drafts, ids, rules);
        const rows = toTransactions(account, items, source, newId);
        await db.transactions.bulkAdd(rows);
        let balanceSet = false;
        if (statement?.balance && useBalance) {
          account.openingBalance = openingBalanceFor(account.id, [...existing, ...rows], statement.balance.amount, statement.balance.asOf);
          await db.accounts.put(account);
          balanceSet = true;
        }
        if (parsed.kind === 'csv') await db.csvMappings.put({ ...parsed.mapping, accountId: account.id });
        return { added: rows.length, skipped: items.length - rows.length, account, balanceSet };
      });
      setDone(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const uncategorized = prepared.filter((p) => !p.duplicate && p.categoryId === 'uncategorized').length;
    return (
      <Sheet title="Import" onClose={props.onClose}>
        <Empty icon="✅" title={`Imported ${done.added} transaction${done.added === 1 ? '' : 's'}`}>
          <p>
            Into <b>{done.account.name}</b>.{done.skipped > 0 && ` ${done.skipped} already-imported transaction${done.skipped === 1 ? ' was' : 's were'} skipped.`}
            {uncategorized > 0 && ` ${uncategorized} need a category.`}
          </p>
          <div class="button-stack">
            <button type="button" class="button primary" onClick={() => nav.showActivity({ accountId: done.account.id })}>
              View Transactions
            </button>
            {!done.balanceSet && (
              <button type="button" class="button" onClick={() => nav.present((close) => <AccountEditor account={done.account} onClose={close} />)}>
                Set Current Balance
              </button>
            )}
            <button type="button" class="button" onClick={props.onClose}>
              Done
            </button>
          </div>
          {!done.balanceSet && <p class="muted small">CSV files don't include your balance. Enter it once so net worth is accurate.</p>}
        </Empty>
      </Sheet>
    );
  }

  if (!parsed) {
    return (
      <Sheet title="Import" onClose={props.onClose}>
        <div class="import-pick">
          <label class="drop">
            <input type="file" onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) onFile(f);
              (e.target as HTMLInputElement).value = '';
            }} />
            <span class="drop-icon" aria-hidden="true">📄</span>
            <strong>Choose a File</strong>
            <span class="muted">CSV, OFX, QFX or QBO from your bank</span>
          </label>
          {error && <p class="error" role="alert">{error}</p>}
        </div>
        <Section title="How to get a file from your bank" footer="Downloaded files go to Files → Downloads, which is where the picker opens. The file is read on this phone and never uploaded.">
          <details class="help">
            <summary>Citizens</summary>
            <p>Sign in at citizensbank.com in Safari (the website, not the Citizens app), open the account and choose the download/export option. Pick <b>OFX / QFX (Quicken)</b> if offered: it includes your balance and avoids duplicates best. CSV works too.</p>
          </details>
          <details class="help">
            <summary>Discover</summary>
            <p>Sign in at discover.com, go to your card's activity and choose download. Pick <b>CSV</b> (or Quicken/QFX). Purchases appear as positive numbers in Discover's CSV, and the app flips them automatically.</p>
          </details>
          <details class="help">
            <summary>Capital One</summary>
            <p>Sign in at capitalone.com, open the card or 360 account, and choose <b>Download Transactions</b> → CSV. Capital One only lets you download about the last 90 days, so import every month or two.</p>
          </details>
          <details class="help">
            <summary>Fidelity</summary>
            <p>Sign in at fidelity.com, open <b>Activity &amp; Orders</b>, pick a date range and use the download icon to get a CSV. Buys and sells are filed under Investments, and dividends count as income. Update the account's balance by hand for an accurate net worth.</p>
          </details>
        </Section>
      </Sheet>
    );
  }

  const m = parsed.kind === 'csv' ? parsed.mapping : undefined;
  const setMapping = (patch: Partial<CsvMapping>) => parsed.kind === 'csv' && setParsed({ ...parsed, mapping: { ...parsed.mapping, ...patch } });
  const colOptions = parsed.kind === 'csv' ? parsed.table.headers.map((h, i) => ({ i, label: h.trim() || `Column ${i + 1}` })) : [];
  const ColSelect = (p: { value: number | null; onChange: (v: number | null) => void; optional?: boolean }) => (
    <select value={p.value ?? ''} onChange={(e) => {
      const v = (e.target as HTMLSelectElement).value;
      p.onChange(v === '' ? null : Number(v));
    }}>
      {p.optional && <option value="">None</option>}
      {colOptions.map((c) => (
        <option value={c.i}>{c.label}</option>
      ))}
    </select>
  );
  const accountList = (accounts ?? []).filter((a) => !a.archived);

  return (
    <Sheet
      title="Review Import"
      onClose={props.onClose}
      onSave={commit}
      saveLabel={busy ? 'Importing…' : `Import ${fresh.length}`}
      saveDisabled={busy || fresh.length === 0 || (accountId === NEW && !newName.trim())}
    >
      <Section
        title="File"
        footer={parsed.kind === 'csv' ? (parsed.saved ? 'Using the column layout you confirmed last time for this bank.' : parsed.note) : undefined}
      >
        <div class="row">
          <span class="row-main">
            <span class="row-title">{parsed.fileName}</span>
            <span class="row-subtitle">
              {parsed.kind === 'csv' ? `${parsed.format}${parsed.saved ? ' · saved layout' : ''}` : statement?.kind === 'credit' ? 'OFX · credit card' : `OFX · ${statement?.bankAccountType?.toLowerCase() ?? 'bank'} account`}
              {statement?.accountNumber && ` · ••••${statement.accountNumber.replace(/\D/g, '').slice(-4)}`}
            </span>
          </span>
          <button type="button" class="link" onClick={() => setParsed(undefined)}>
            Change
          </button>
        </div>
        {parsed.kind === 'ofx' && parsed.statements.length > 1 && (
          <Field label="Statement">
            <select value={parsed.index} onChange={(e) => setParsed({ ...parsed, index: Number((e.target as HTMLSelectElement).value) })}>
              {parsed.statements.map((s, i) => (
                <option value={i}>
                  {s.kind === 'credit' ? 'Card' : s.bankAccountType ?? 'Account'} ••••{s.accountNumber?.slice(-4)} ({s.transactions.length})
                </option>
              ))}
            </select>
          </Field>
        )}
      </Section>

      <Section title="Import into">
        <Field label="Account">
          <select value={accountId} onChange={(e) => setAccountId((e.target as HTMLSelectElement).value)}>
            {accountList.map((a) => (
              <option value={a.id}>{a.name}</option>
            ))}
            <option value={NEW}>＋ New account…</option>
          </select>
        </Field>
        {accountId === NEW && (
          <>
            <Field label="Name">
              <input value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Type">
              <select value={newType} onChange={(e) => setNewType((e.target as HTMLSelectElement).value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                  <option value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {statement?.balance && (
          <Toggle
            checked={useBalance}
            onChange={setUseBalance}
            label={`Set balance to ${formatMoney(statement.balance.amount)} (as of ${formatDay(statement.balance.asOf)})`}
          />
        )}
      </Section>

      {m && (
        <Section title="Columns" footer="Purchases should show as negative amounts in the preview below. If they're positive, turn on Flip signs.">
          <Field label="Date">
            <ColSelect value={m.date} onChange={(v) => setMapping({ date: v ?? 0 })} />
          </Field>
          <Field label="Description">
            <ColSelect value={m.description} onChange={(v) => setMapping({ description: v ?? 0 })} />
          </Field>
          <Field label="Amounts in">
            <select
              value={m.amount != null ? 'one' : 'two'}
              onChange={(e) =>
                (e.target as HTMLSelectElement).value === 'one'
                  ? setMapping({ amount: m.debit ?? m.credit ?? 0, debit: null, credit: null })
                  : setMapping({ amount: null, debit: m.amount ?? 0, credit: m.amount ?? 0, type: null })
              }
            >
              <option value="one">One column</option>
              <option value="two">Separate debit / credit columns</option>
            </select>
          </Field>
          {m.amount != null ? (
            <Field label="Amount">
              <ColSelect value={m.amount} onChange={(v) => setMapping({ amount: v ?? 0 })} />
            </Field>
          ) : (
            <>
              <Field label="Money out (debit)">
                <ColSelect value={m.debit} optional onChange={(v) => setMapping({ debit: v })} />
              </Field>
              <Field label="Money in (credit)">
                <ColSelect value={m.credit} optional onChange={(v) => setMapping({ credit: v })} />
              </Field>
            </>
          )}
          <Field label="Bank category">
            <ColSelect value={m.category} optional onChange={(v) => setMapping({ category: v })} />
          </Field>
          <Toggle checked={m.invert} onChange={(v) => setMapping({ invert: v })} label="Flip signs" />
        </Section>
      )}

      <Section
        title={`Preview · ${fresh.length} new`}
        footer={[
          dates.length ? `${formatDay(dates[0])} – ${formatDay(dates[dates.length - 1])}.` : '',
          dupes ? `${dupes} already imported (will be skipped).` : '',
          read.skipped ? `${read.skipped} row${read.skipped === 1 ? '' : 's'} without a date or amount ignored.` : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {prepared.length === 0 ? (
          <div class="row muted">No transactions found. Check the columns above.</div>
        ) : (
          fresh.slice(0, 25).map((p) => (
            <div class="row txn-row">
              <CategoryIcon category={cats.get(p.categoryId)} />
              <span class="row-main">
                <span class="row-title">{p.payee}</span>
                <span class="row-subtitle">
                  {formatDay(p.draft.date)} · {cats.get(p.categoryId)?.name}
                </span>
              </span>
              <span class="row-detail">
                <Money cents={p.draft.amount} colored />
              </span>
            </div>
          ))
        )}
        {fresh.length > 25 && <div class="row muted">…and {fresh.length - 25} more</div>}
      </Section>
      {error && <p class="error padded" role="alert">{error}</p>}
    </Sheet>
  );
}
