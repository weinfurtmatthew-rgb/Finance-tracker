import { useMemo, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, newId } from '../db';
import { useNav } from '../nav';
import type { Account, AccountType, CsvMapping, Transaction, TransactionSource } from '../types';
import { findAlreadyImported, idsOf } from '../lib/dedupe';
import type { PreparedTransaction } from '../lib/importer';
import type { DraftTransaction } from '../lib/draft';
import { csvToDrafts, detectFormat, headerSignature, readCsv, type CsvTable } from '../lib/csv';
import { looksLikeOfx, parseOfx, type OfxStatement } from '../lib/ofx';
import { APP_NAMES, appImportIds, linkWaitingPayments, placeAppTransactions, readPaymentApp, type AppFile } from '../lib/p2p';
import { PaybackList, usePaymentAppNudges, WhatWasThis } from './People';
import { prepareImport, toTransactions } from '../lib/importer';
import { payeeHistory } from '../lib/categorize';
import { aiState } from '../ai/client';
import { automaticPicks } from '../ai/suggest';
import { ReviewAiPicks } from './ReviewAiPicks';
import { RocketRepair } from '../components/RocketRepair';
import { accountFor, accountTypeFor, rocketGroups, type RocketGroup } from '../lib/rocketmoney';
import { BalanceCheck } from '../components/BalanceCheck';
import { isValued } from '../lib/networth';
import { openingBalanceFor } from '../lib/balances';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { CategoryIcon, Empty, Field, Money, Section, Sheet, Toggle } from '../components/ui';
import { ACCOUNT_TYPES } from './AccountEditor';

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

interface AppState {
  kind: 'app';
  file: AppFile;
}

type Parsed = (CsvState | OfxState | AppState) & { fileName: string };

const NEW = '__new__';

/** The open account that already has most of these transactions (at least 3), if any. */
async function accountWithMostMatches(accounts: Account[], drafts: DraftTransaction[]): Promise<string | undefined> {
  let best: { id: string; n: number } | undefined;
  const rows = drafts.map((d, i) => ({ date: d.date, amount: d.amount, description: d.description, importId: `probe:${i}` }));
  for (const a of accounts.filter((x) => !x.archived)) {
    const n = findAlreadyImported(rows, await db.transactions.where('accountId').equals(a.id).toArray()).size;
    if (n >= 3 && (!best || n > best.n)) best = { id: a.id, n };
  }
  return best?.id;
}

/** Rows found to be already in the account (under another file format's id) are skipped, unless included. */
const skipLikely = (items: PreparedTransaction[], include: boolean) => (include ? items : items.map((p) => (p.likely ? { ...p, duplicate: true } : p)));

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
  // Rocket Money files hold several accounts: the one being imported, and the ones done this time.
  const [group, setGroup] = useState<string>();
  const [doneGroups, setDoneGroups] = useState<string[]>([]);
  const [busy, setBusy] = useState<false | 'import' | 'ai'>(false);
  const [done, setDone] = useState<{ added: number; skipped: number; account: Account; balanceSet: boolean; uncategorized: number; byAi: number; merged: number; waiting: number }>();
  // What you've categorized yourself teaches new imports: same payee, same category.
  const allTxns = useLiveQuery(() => db.transactions.toArray(), []);
  const nudges = usePaymentAppNudges();
  const history = useMemo(() => payeeHistory(allTxns ?? []), [allTxns]);

  const existing = useLiveQuery(async () => {
    if (accountId === NEW) return { ids: new Set<string>(), txns: [] as Transaction[] };
    const txns = await db.transactions.where('accountId').equals(accountId).toArray();
    // App payments already merged into a bank line count as imported too.
    return { ids: new Set([...txns.flatMap(idsOf), ...appImportIds(await db.transactions.toArray())]), txns };
  }, [accountId]);
  // Rows that are already in the account from a different kind of file are skipped unless you say so.
  const [includeLikely, setIncludeLikely] = useState(false);

  const onFile = async (file: File) => {
    setError(undefined);
    try {
      const text = await file.text();
      // Read accounts now rather than from the live list, which may not have loaded yet if a file is
      // picked the moment the sheet opens (the file would then look like it's for a new account).
      const known = await db.accounts.toArray();
      const ofxLike = /\.(ofx|qfx|qbo)$/i.test(file.name) || looksLikeOfx(text);
      let nextAccount = props.accountId;
      const appFile = ofxLike ? null : readPaymentApp(text);
      if (appFile) {
        // Venmo / Cash App: its own "Payment app" account.
        const name = APP_NAMES[appFile.app];
        setParsed({ kind: 'app', file: appFile, fileName: file.name });
        nextAccount ??= known.find((a) => a.type === 'wallet' && !a.archived && `${a.institution} ${a.name}`.toLowerCase().includes(name.toLowerCase()))?.id;
        setNewType('wallet');
        setNewInstitution(name);
        setNewName(name);
      } else if (ofxLike) {
        const statements = parseOfx(text);
        if (!statements.length) throw new Error('No account statement was found in this file.');
        const st = statements[0];
        setParsed({ kind: 'ofx', statements, index: 0, fileName: file.name });
        const last4 = st.accountNumber?.replace(/\D/g, '').slice(-4);
        nextAccount ??= known.find((a) => last4 && a.last4 === last4)?.id;
        // An account first imported from a CSV has no account number: pick the one that already has
        // these transactions.
        nextAccount ??= await accountWithMostMatches(known, st.transactions);
        setNewType(guessAccountType('', st));
        setNewInstitution(guessInstitution('', file.name));
        setNewName(`${guessInstitution('', file.name) || 'Bank'} ${ACCOUNT_TYPES.find((t) => t.value === guessAccountType('', st))?.label ?? ''}`.trim());
      } else {
        const table = readCsv(text);
        if (table.headerIndex < 0) throw new Error("This doesn't look like a transactions file.");
        const found = await db.csvMappings.get(headerSignature(table.headers));
        const detected = detectFormat(table, known.find((a) => a.id === (nextAccount ?? found?.accountId))?.type);
        // A Rocket Money file is always read as one (a layout saved from a plain import of it was wrong).
        const rocket = detected.format === 'Rocket Money';
        const saved = rocket ? undefined : found;
        setParsed({
          kind: 'csv',
          table,
          format: detected.format,
          note: detected.note,
          mapping: saved ?? detected.mapping,
          saved: !!saved,
          fileName: file.name,
        });
        if (rocket) {
          const groups = rocketGroups(csvToDrafts(table, detected.mapping).drafts);
          const g = (props.accountId && groups.find((x) => accountFor(x.account, known)?.id === props.accountId)) || groups[0];
          if (g) {
            setGroup(g.account.key);
            setDoneGroups([]);
            await suggestAccount(g, known, props.accountId);
            return;
          }
        }
        nextAccount ??= saved?.accountId && known.some((a) => a.id === saved.accountId) ? saved.accountId : undefined;
        nextAccount ??= await accountWithMostMatches(known, csvToDrafts(table, saved ?? detected.mapping).drafts);
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

  /** Point the import at the app account for a Rocket Money account (or a new one named after it). */
  const suggestAccount = async (g: RocketGroup, known: Account[], preferred?: string) => {
    const id = preferred ?? accountFor(g.account, known)?.id ?? (await accountWithMostMatches(known, g.drafts));
    setNewType(accountTypeFor(g.account));
    setNewInstitution(g.account.institution ?? '');
    setNewName(g.account.name);
    setAccountId(id ?? NEW);
  };

  const statement = parsed?.kind === 'ofx' ? parsed.statements[parsed.index] : undefined;
  const csvDrafts = useMemo(() => (parsed?.kind === 'csv' ? csvToDrafts(parsed.table, parsed.mapping) : undefined), [parsed]);
  const groups = useMemo(() => rocketGroups(csvDrafts?.drafts ?? []), [csvDrafts]);
  const currentGroup = groups.find((g) => g.account.key === group);
  const fileBalance = statement?.balance ?? (parsed?.kind === 'app' ? parsed.file.balance : undefined);
  const accountType = accountId === NEW ? newType : accounts?.find((a) => a.id === accountId)?.type;
  const read = useMemo((): { drafts: DraftTransaction[]; skipped: number } => {
    if (!parsed) return { drafts: [], skipped: 0 };
    if (parsed.kind === 'ofx') return { drafts: parsed.statements[parsed.index].transactions, skipped: 0 };
    if (parsed.kind === 'app') return { drafts: parsed.file.drafts, skipped: parsed.file.skipped };
    if (currentGroup) return { drafts: currentGroup.drafts, skipped: csvDrafts!.skipped };
    return csvDrafts!;
  }, [parsed, csvDrafts, currentGroup]);

  const prepared = useMemo(
    () =>
      existing && rules
        ? skipLikely(prepareImport(accountId, read.drafts, existing.ids, rules, { history, creditAccount: accountType === 'credit', existing: existing.txns }), includeLikely)
        : [],
    [read, existing, rules, accountId, history, accountType, includeLikely],
  );
  const fresh = prepared.filter((p) => !p.duplicate);
  const dupes = prepared.length - fresh.length;
  const likely = prepared.filter((p) => p.likely);
  const cats = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c])), [categories]);
  const dates = read.drafts.map((d) => d.date).sort();

  const commit = async () => {
    if (!parsed || !rules) return;
    setBusy('import');
    try {
      const source: TransactionSource = parsed.kind === 'ofx' ? 'ofx' : 'csv';
      const result = await db.transaction('rw', [db.accounts, db.transactions, db.csvMappings], async () => {
        let account = accountId === NEW ? undefined : await db.accounts.get(accountId);
        // Remember the account number from a QFX/OFX file, so the next one finds this account directly.
        const fileLast4 = statement?.accountNumber?.replace(/\D/g, '').slice(-4) ?? currentGroup?.account.last4;
        if (account && fileLast4 && !account.last4) {
          account.last4 = fileLast4;
          await db.accounts.update(account.id, { last4: fileLast4 });
        }
        if (!account) {
          const last4 = statement?.accountNumber?.replace(/\D/g, '').slice(-4) ?? currentGroup?.account.last4;
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
        const all = await db.transactions.toArray();
        const existing = all.filter((t) => t.accountId === account!.id);
        const ids = new Set([...existing.flatMap(idsOf), ...appImportIds(all)]);
        const items = skipLikely(prepareImport(account.id, read.drafts, ids, rules, { history, creditAccount: account.type === 'credit', existing }), includeLikely);
        // The same purchases from a different file format: remember this format's ids on them, so the
        // next import of either kind recognizes them.
        const matched = new Map<string, string[]>();
        for (const p of items) if (p.likely && p.duplicate) matched.set(p.likely.id, [...(matched.get(p.likely.id) ?? []), p.importId]);
        for (const [id, extra] of matched) {
          const t = existing.find((x) => x.id === id)!;
          await db.transactions.update(id, { altImportIds: [...new Set([...(t.altImportIds ?? []), ...extra])] });
        }
        const fresh = toTransactions(account, items, source, newId);
        const allAccounts = await db.accounts.toArray();
        // Payment apps: payments paid from your bank land on the bank's line (or wait for it), so
        // nothing counts twice.
        const placed = placeAppTransactions(fresh, all, allAccounts, newId);
        const rows = placed.add;
        await db.transactions.bulkAdd(rows);
        for (const u of placed.update) await db.transactions.update(u.id, u.changes);
        // A bank file: app payments that were waiting for their bank line merge into it now.
        const linked = linkWaitingPayments(await db.transactions.toArray(), allAccounts);
        for (const u of linked.update) await db.transactions.update(u.id, u.changes);
        await db.transactions.bulkDelete(linked.remove);
        const removed = new Set(linked.remove);
        const kept = rows.filter((r) => !removed.has(r.id));
        const merged = placed.update.filter((u) => u.changes.p2p).length + linked.update.filter((u) => u.changes.p2p).length;
        const waiting = kept.filter((r) => r.p2p?.role === 'payment').length;
        let balanceSet = false;
        if (fileBalance && useBalance) {
          account.openingBalance = openingBalanceFor(account.id, [...existing.filter((t) => !removed.has(t.id)), ...kept], fileBalance.amount, fileBalance.asOf);
          // The file carries the bank's own balance, so this counts as checked.
          account.checkedOn = fileBalance.asOf;
          account.balanceSetAt = Date.now();
          await db.accounts.put(account);
          balanceSet = true;
        }
        if (parsed.kind === 'csv') await db.csvMappings.put({ ...parsed.mapping, accountId: account.id });
        const added = kept.filter((r) => r.p2p?.role !== 'funding').length;
        return { added, skipped: items.length - fresh.length, account, balanceSet, rows: kept, merged, waiting };
      });
      // On-device AI: confidently categorize what the rules and keywords couldn't, marked for review.
      let byAi = 0;
      if (aiState().embed && categories && result.rows.length) {
        setBusy('ai');
        try {
          const picks = await automaticPicks(new Set(result.rows.filter((r) => r.p2p?.role !== 'funding').map((r) => r.id)), await db.transactions.toArray(), categories);
          await db.transactions.bulkUpdate(picks.map((p) => ({ key: p.id, changes: { categoryId: p.categoryId, categorySource: 'ai' as const } })));
          byAi = picks.length;
        } catch {
          // The import itself worked; AI is a bonus.
        }
      }
      const saved = await db.transactions.bulkGet(result.rows.map((r) => r.id));
      const uncategorized = saved.filter((t) => t?.categoryId === 'uncategorized').length;
      if (group) setDoneGroups((d) => [...d, group]);
      setDone({ added: result.added, skipped: result.skipped, account: result.account, balanceSet: result.balanceSet, uncategorized, byAi, merged: result.merged, waiting: result.waiting });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const nextGroup = groups.find((g) => g.account.key !== group && !doneGroups.includes(g.account.key));

  if (done) {
    const { uncategorized, byAi, merged, waiting } = done;
    return (
      <Sheet title="Import" onClose={props.onClose}>
        <Empty icon="✅" title={`Imported ${done.added} transaction${done.added === 1 ? '' : 's'}`}>
          <p>
            Into <b>{done.account.name}</b>.{done.skipped > 0 && ` ${done.skipped} already-imported transaction${done.skipped === 1 ? ' was' : 's were'} skipped.`}
            {uncategorized > 0 && ` ${uncategorized} need a category.`}
          </p>
          {merged > 0 && (
            <p class="merge-note">
              🔗 {merged} payment{merged === 1 ? '' : 's'} paid from your bank {merged === 1 ? 'was' : 'were'} matched to the bank’s own line{merged === 1 ? '' : 's'}, so {merged === 1 ? 'it isn’t' : 'they aren’t'} counted twice.
            </p>
          )}
          {waiting > 0 && (
            <p>
              {waiting} payment{waiting === 1 ? '' : 's'} paid from your bank will be matched when you import that bank’s file.
            </p>
          )}
          {byAi > 0 && (
            <p>
              ✨ On-device AI categorized {byAi} more. They're marked so you can check them.
            </p>
          )}
          <div class="button-stack">
            {byAi > 0 && (
              <button type="button" class="button primary" onClick={() => nav.present((close) => <ReviewAiPicks onClose={close} />)}>
                Review AI Picks
              </button>
            )}
            {nudges.unexplained.length > 0 && (
              <button type="button" class="button" onClick={() => nav.present((close) => <WhatWasThis onClose={close} />)}>
                What Were These? ({nudges.unexplained.length})
              </button>
            )}
            {nextGroup && (
              <button
                type="button"
                class="button primary"
                onClick={async () => {
                  setGroup(nextGroup.account.key);
                  await suggestAccount(nextGroup, await db.accounts.toArray());
                  setDone(undefined);
                }}
              >
                Import Next: {nextGroup.account.name}
              </button>
            )}
            <button type="button" class={`button ${byAi > 0 || nextGroup ? '' : 'primary'}`} onClick={() => nav.showActivity({ accountId: done.account.id })}>
              View Transactions
            </button>
            <button type="button" class="button" onClick={props.onClose}>
              Done
            </button>
          </div>
        </Empty>
        <PaybackList paybacks={nudges.paybacks} />
        {done.balanceSet ? (
          <p class="section-footer intro">✓ Balance set from {parsed?.kind === 'app' ? `${APP_NAMES[parsed.file.app]}'s statement` : "your bank's file"}.</p>
        ) : (
          !isValued(done.account) && (
            <BalanceCheck
              account={done.account}
              intro="Optional, but it keeps your net worth and budgets right: type the balance your bank shows now. The app checks it and explains any difference."
            />
          )
        )}
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
            <span class="muted">CSV, OFX, QFX or QBO from your bank, or a Venmo or Cash App statement</span>
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
            <summary>Venmo</summary>
            <p>Sign in at venmo.com in Safari, open <b>Statements</b> (under your account menu), pick a month and choose <b>Download CSV</b>. Import it once a month. Payments paid from your bank or debit card are matched to your bank’s own line so nothing counts twice, and money from friends is matched to what they owe you.</p>
          </details>
          <details class="help">
            <summary>Cash App</summary>
            <p>Sign in at cash.app in Safari, open <b>Activity</b> or <b>Statements</b> and choose <b>Export CSV</b>. It works like Venmo: payments from your debit card match your bank’s line, and cash-outs are filed as transfers.</p>
          </details>
          <details class="help">
            <summary>Apple Cash</summary>
            <p>Apple doesn’t offer a download of Apple Cash activity. Payments paid from your debit card still show in your bank’s file (“APPLE CASH SENT MONEY”), and the app asks what they were for. For payments from your Apple Cash balance, use <b>People → Log a Payment</b>. It takes a few seconds.</p>
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
      saveLabel={busy === 'ai' ? 'Categorizing…' : busy ? 'Importing…' : `Import ${fresh.length}`}
      saveDisabled={!!busy || fresh.length === 0 || (accountId === NEW && !newName.trim())}
    >
      <Section
        title="File"
        footer={
          parsed.kind === 'csv'
            ? parsed.saved
              ? 'Using the column layout you confirmed last time for this bank.'
              : parsed.note
            : parsed.kind === 'app'
              ? 'Payments paid from your bank or debit card are matched to the bank’s own line, so they aren’t counted twice. Transfers to and from your bank are filed under Transfer.'
              : undefined
        }
      >
        <div class="row">
          <span class="row-main">
            <span class="row-title">{parsed.fileName}</span>
            <span class="row-subtitle">
              {parsed.kind === 'app'
                ? `${APP_NAMES[parsed.file.app]} ${parsed.file.app === 'venmo' ? 'statement' : 'activity'}`
                : parsed.kind === 'csv'
                  ? `${parsed.format}${parsed.saved ? ' · saved layout' : ''}`
                  : statement?.kind === 'credit'
                    ? 'OFX · credit card'
                    : `OFX · ${statement?.bankAccountType?.toLowerCase() ?? 'bank'} account`}
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

      {groups.length > 0 && csvDrafts && <RocketRepair drafts={csvDrafts.drafts} />}

      {groups.length > 1 && (
        <Section title="Rocket Money account" footer={`This file has ${groups.length} accounts. Import them one at a time, each into its own account.`}>
          <Field label="From">
            <select
              value={group}
              onChange={async (e) => {
                const key = (e.target as HTMLSelectElement).value;
                setGroup(key);
                const g = groups.find((x) => x.account.key === key);
                if (g) await suggestAccount(g, await db.accounts.toArray());
              }}
            >
              {groups.map((g) => (
                <option value={g.account.key}>
                  {g.account.label} ({g.drafts.length}){doneGroups.includes(g.account.key) ? ' ✓' : ''}
                </option>
              ))}
            </select>
          </Field>
        </Section>
      )}

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
        {fileBalance && (
          <Toggle
            checked={useBalance}
            onChange={setUseBalance}
            label={`Set balance to ${formatMoney(fileBalance.amount)} (as of ${formatDay(fileBalance.asOf)})`}
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

      {likely.length > 0 && (
        <Section
          title={`Already in ${accounts?.find((a) => a.id === accountId)?.name ?? 'this account'}`}
          footer="Same amount and store within a few days of a transaction you imported from a different file (for example a CSV before, a QFX now). They're skipped so nothing counts twice."
        >
          <details class="help likely-list">
            <summary>
              {likely.length} transaction{likely.length === 1 ? '' : 's'} matched {likely.length === 1 ? 'one' : 'ones'} you already have
            </summary>
            {likely.slice(0, 50).map((p) => (
              <div class="row">
                <span class="row-main">
                  <span class="row-title">{p.payee}</span>
                  <span class="row-subtitle">
                    {formatDay(p.draft.date)} · same as “{p.likely!.payee}” on {formatDay(p.likely!.date)}
                  </span>
                </span>
                <span class="row-detail">
                  <Money cents={p.draft.amount} colored />
                </span>
              </div>
            ))}
          </details>
          <Toggle checked={includeLikely} onChange={setIncludeLikely} label="Import these anyway" />
        </Section>
      )}

      <Section
        title={`Preview · ${fresh.length} new`}
        footer={[
          dates.length ? `${formatDay(dates[0])} – ${formatDay(dates[dates.length - 1])}.` : '',
          dupes ? `${dupes} already imported (will be skipped).` : '',
          likely.length && includeLikely ? `${likely.length} that look already imported will be added anyway.` : '',
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
                  {p.draft.p2p?.note ? ` · “${p.draft.p2p.note}”` : ''}
                  {p.draft.p2p?.fundedFrom ? ` · from ${p.draft.p2p.fundedFrom}` : ''}
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
