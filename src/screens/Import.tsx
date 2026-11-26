import { useMemo, useState } from 'preact/hooks';
import { Glyph } from '../components/icons';
import { useStore } from '../store';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, newId } from '../db';
import { useNav } from '../nav';
import type { Account, AccountType, CsvMapping, Transaction, TransactionSource } from '../types';
import { findAlreadyImported, idsOf } from '../lib/dedupe';
import type { PreparedTransaction } from '../lib/importer';
import type { DraftTransaction } from '../lib/draft';
import { csvToDrafts, detectFormat, headerSignature, looksLikeTransactions, readCsv, type CsvTable } from '../lib/csv';
import { readPositions } from '../lib/positions';
import { looksLikeOfx, parseOfx, type OfxStatement } from '../lib/ofx';
import { APP_NAMES, appImportIds, linkWaitingPayments, placeAppTransactions, readPaymentApp, type AppFile } from '../lib/p2p';
import { PaybackList, usePaymentAppNudges, WhatWasThis } from './People';
import { prepareImport, toTransactions } from '../lib/importer';
import { payeeHistory } from '../lib/categorize';
import { aiState } from '../ai/client';
import { automaticPicks } from '../ai/suggest';
import { ReviewAiPicks } from './ReviewAiPicks';
import { RocketRepair } from '../components/RocketRepair';
import { findEarlierImport, planRepair } from '../lib/rocketmoney';
import { groupBySource, IMPORT_ROUTES, newAccountFor, routeFor, SKIP, tidyName } from '../lib/sourceAccounts';
import { BalanceCheck } from '../components/BalanceCheck';
import { isValued } from '../lib/networth';
import { openingBalanceFor } from '../lib/balances';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { CategoryIcon, Empty, Field, Money, Section, Sheet, Toggle } from '../components/ui';
import { ACCOUNT_TYPES, typeName } from './AccountEditor';
import { recordImport, takeSnapshot, undoLastImport } from '../lib/importUndo';
import { moveLineTrades, tradesForImport, type ImportNotes } from '../lineTrades';

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

/** Where an account in a file with several goes: an app account, a new one (named and typed here), or nowhere (SKIP). */
interface Route {
  to: string;
  name: string;
  type: AccountType;
  institution: string;
}

/** A row in the preview, and for a file with several accounts, which one in the file it's from. */
type Shown = PreparedTransaction & { group?: string };

const listed = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

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
    return t === 'SAVINGS' || t === 'MONEYMRKT' ? 'savings' : t === 'CREDITLINE' ? 'credit' : t === 'CD' ? 'cd' : 'checking';
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
  const accounts = useStore().raw.accounts;
  const rules = useStore().raw.rules;
  const categories = useStore().raw.categories;
  const [parsed, setParsed] = useState<Parsed>();
  const [error, setError] = useState<string>();
  const [accountId, setAccountId] = useState<string>(props.accountId ?? NEW);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('checking');
  const [newInstitution, setNewInstitution] = useState('');
  const [useBalance, setUseBalance] = useState(true);
  // Files with several accounts (Fidelity, Rocket Money…): where each one goes.
  const [routes, setRoutes] = useState<Record<string, Route>>({});
  const [busy, setBusy] = useState<false | 'import' | 'ai'>(false);
  const [done, setDone] = useState<{
    added: number;
    skipped: number;
    account: Account;
    balanceSet: boolean;
    uncategorized: number;
    byAi: number;
    merged: number;
    waiting: number;
    /** A file with several accounts: how many went into each, and what was put right from an earlier import of it. */
    into?: { account: Account; added: number }[];
    fixed?: { fixed: number; moved: number; merged: number };
    /** Purchases and sales in the lines it brought in: what went into holdings, and what waits (lib/bankTrades.ts). */
    trades?: ImportNotes;
  }>();
  // What you've categorized yourself teaches new imports: same payee, same category.
  const allTxns = useStore().raw.transactions;
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
        setNewName(`${guessInstitution('', file.name) || 'Bank'} ${typeName(guessAccountType('', st))}`.trim());
      } else {
        const table = readCsv(text);
        if (table.headerIndex < 0) throw new Error('This doesn’t look like a transactions file.');
        // A brokerage's positions file (what you hold) has symbols and shares too, but no dates.
        if (!looksLikeTransactions(table) && readPositions(text))
          throw new Error('This is a positions file: what you hold, not your activity. To bring it in, open the investment account in Net Worth and choose Import Positions.');
        const found = await db.csvMappings.get(headerSignature(table.headers));
        const detected = detectFormat(table, known.find((a) => a.id === (nextAccount ?? found?.accountId))?.type);
        // A Rocket Money file is always read as one (a layout saved from a plain import of it was wrong).
        const rocket = detected.format === 'Rocket Money';
        const saved = rocket ? undefined : found;
        // A layout saved before the app read the account column still splits the file by account.
        // A layout saved before the app read these columns gets them from the file.
        const mapping = saved
          ? {
              ...saved,
              sourceAccount: saved.sourceAccount ?? detected.mapping.sourceAccount,
              symbol: saved.symbol ?? detected.mapping.symbol,
              quantity: saved.quantity ?? detected.mapping.quantity,
            }
          : detected.mapping;
        setParsed({ kind: 'csv', table, format: detected.format, note: detected.note, mapping, saved: !!saved, fileName: file.name });
        const fallback = guessAccountType(detected.format);
        const groups = groupBySource(csvToDrafts(table, mapping).drafts);
        const remembered = (await getMeta<Record<string, string>>(IMPORT_ROUTES)) ?? {};
        if (groups.length > 1) {
          // Several accounts: each goes where it went last time, or to the app account with its number or name.
          const next: Record<string, Route> = {};
          for (const g of groups) next[g.account.key] = { to: routeFor(g.account, known, remembered) ?? NEW, ...newAccountFor(g.account, fallback) };
          setRoutes(next);
          return;
        }
        setRoutes({});
        const inst = guessInstitution(detected.format, file.name);
        setNewType(fallback);
        setNewInstitution(inst);
        setNewName(`${inst || 'New'} ${typeName(fallback)}`.trim());
        const only = groups[0];
        if (only) {
          // One account named in the file: the app account it goes to, or a new one named after it.
          const to = routeFor(only.account, known, remembered);
          if (to && to !== SKIP) nextAccount ??= to;
          const fresh = newAccountFor(only.account, fallback);
          setNewType(fresh.type);
          setNewInstitution(fresh.institution);
          setNewName(fresh.name);
        }
        nextAccount ??= saved?.accountId && known.some((a) => a.id === saved.accountId) ? saved.accountId : undefined;
        nextAccount ??= await accountWithMostMatches(known, csvToDrafts(table, mapping).drafts);
      }
      setAccountId(nextAccount ?? NEW);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const statement = parsed?.kind === 'ofx' ? parsed.statements[parsed.index] : undefined;
  const csvDrafts = useMemo(() => (parsed?.kind === 'csv' ? csvToDrafts(parsed.table, parsed.mapping) : undefined), [parsed]);
  const groups = useMemo(() => groupBySource(csvDrafts?.drafts ?? []), [csvDrafts]);
  const multi = groups.length > 1;
  const fileBalance = statement?.balance ?? (parsed?.kind === 'app' ? parsed.file.balance : undefined);
  const accountType = accountId === NEW ? newType : accounts?.find((a) => a.id === accountId)?.type;
  const read = useMemo((): { drafts: DraftTransaction[]; skipped: number } => {
    if (!parsed) return { drafts: [], skipped: 0 };
    if (parsed.kind === 'ofx') return { drafts: parsed.statements[parsed.index].transactions, skipped: 0 };
    if (parsed.kind === 'app') return { drafts: parsed.file.drafts, skipped: parsed.file.skipped };
    return csvDrafts!;
  }, [parsed, csvDrafts]);

  // Rows of this file that came in before as one plain file (every account in one): importing moves them
  // to the accounts chosen below (and fixes their signs, for Rocket Money). Ones already in place stay.
  const earlierAll = useMemo(() => (multi && accounts && allTxns ? findEarlierImport(csvDrafts!.drafts, accounts, allTxns) : []), [multi, csvDrafts, accounts, allTxns]);
  // Where each account in the file goes, leaving out the names typed for new ones: typing a name
  // doesn't need the preview worked out again (a file can have thousands of rows).
  const routeKey = groups
    .map((g) => {
      const r = routes[g.account.key];
      return r ? `${r.to}:${r.to === NEW ? r.type : ''}` : '';
    })
    .join('|');
  const earlier = useMemo(
    () =>
      earlierAll.filter((e) => {
        const key = csvDrafts?.drafts[e.row].sourceAccount?.key;
        const r = key ? routes[key] : undefined;
        return !!r && r.to !== SKIP && (e.flipped || r.to !== e.txn.accountId);
      }),
    [earlierAll, routeKey, csvDrafts],
  );
  const single = useMemo(
    () =>
      !multi && existing && rules
        ? skipLikely(prepareImport(accountId, read.drafts, existing.ids, rules, { history, creditAccount: accountType === 'credit', existing: existing.txns }), includeLikely)
        : [],
    [multi, read, existing, rules, accountId, history, accountType, includeLikely],
  );
  // Several accounts: each one's rows against the account it goes to (less the ones that only move).
  const routed = useMemo(() => {
    if (!multi || !rules || !allTxns || !csvDrafts) return [];
    const appIds = appImportIds(allTxns);
    const moving = new Set(earlier.map((e) => csvDrafts.drafts[e.row]));
    return groups.map((g) => {
      const r = routes[g.account.key];
      if (!r || r.to === SKIP) return { g, items: [] as Shown[] };
      const mine = r.to === NEW ? [] : allTxns.filter((t) => t.accountId === r.to);
      const type = r.to === NEW ? r.type : accounts?.find((a) => a.id === r.to)?.type;
      const items = skipLikely(
        prepareImport(
          r.to === NEW ? `${NEW}:${g.account.key}` : r.to,
          g.drafts.filter((d) => !moving.has(d)),
          new Set([...mine.flatMap(idsOf), ...appIds]),
          rules,
          { history, creditAccount: type === 'credit', existing: mine },
        ),
        includeLikely,
      ).map((p): Shown => ({ ...p, group: g.account.key }));
      return { g, items };
    });
  }, [multi, groups, routeKey, rules, allTxns, accounts, history, includeLikely, csvDrafts, earlier]);
  const prepared: Shown[] = multi ? routed.flatMap((x) => x.items) : single;
  /** Which account in the file a preview row is from: its last 4 digits, as in the list above, or its name. */
  const fromLabel = (key: string) => {
    const a = groups.find((g) => g.account.key === key)?.account;
    return !a ? '' : a.last4 ? `••${a.last4}` : tidyName(a.name);
  };
  const missingName = multi && groups.some((g) => routes[g.account.key]?.to === NEW && !routes[g.account.key].name.trim());
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
      // A copy of what the import can touch, so it can be undone.
      const before = await takeSnapshot();
      const result = await db.transaction('rw', [db.accounts, db.transactions, db.csvMappings, db.meta, db.trades, db.securities], async () => {
        let account = accountId === NEW ? undefined : await db.accounts.get(accountId);
        // Remember the account number from a QFX/OFX file, so the next one finds this account directly.
        const fileLast4 = statement?.accountNumber?.replace(/\D/g, '').slice(-4) ?? groups[0]?.account.last4;
        if (account && fileLast4 && !account.last4) {
          account.last4 = fileLast4;
          await db.accounts.update(account.id, { last4: fileLast4 });
        }
        if (!account) {
          const last4 = statement?.accountNumber?.replace(/\D/g, '').slice(-4) ?? groups[0]?.account.last4;
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
        // An investment account's purchases and sales go into its holdings too.
        const trades = await tradesForImport(new Set(kept.map((r) => r.id)));
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
        // The account named in the file goes here next time too.
        const named = groups[0]?.account;
        if (named) {
          const routes = (await getMeta<Record<string, string>>(IMPORT_ROUTES)) ?? {};
          await db.meta.put({ key: IMPORT_ROUTES, value: { ...routes, [named.ref ?? named.key]: account.id } });
        }
        const added = kept.filter((r) => r.p2p?.role !== 'funding').length;
        return { added, skipped: items.length - fresh.length, account, balanceSet, rows: kept, merged, waiting, trades: trades.notes };
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
      await recordImport(before, `${result.added} transaction${result.added === 1 ? '' : 's'} into ${result.account.name}`);
      const saved = await db.transactions.bulkGet(result.rows.map((r) => r.id));
      const uncategorized = saved.filter((t) => t?.categoryId === 'uncategorized').length;
      setDone({
        added: result.added,
        skipped: result.skipped,
        account: result.account,
        balanceSet: result.balanceSet,
        uncategorized,
        byAi,
        merged: result.merged,
        waiting: result.waiting,
        trades: result.trades,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * A file with several accounts: each one into the account it goes to (made now for a new one). Rows that
   * came in before as one plain file move to their accounts first (signs fixed for Rocket Money), so
   * nothing is added twice. Where each one went is remembered for the next file.
   */
  const commitMulti = async () => {
    if (!parsed || parsed.kind !== 'csv' || !rules || !csvDrafts) return;
    setBusy('import');
    try {
      const drafts = csvDrafts.drafts;
      const before = await takeSnapshot();
      const result = await db.transaction('rw', [db.accounts, db.transactions, db.csvMappings, db.meta, db.trades, db.securities], async () => {
        const known = await db.accounts.toArray();
        const remembered = { ...((await getMeta<Record<string, string>>(IMPORT_ROUTES)) ?? {}) };
        const target = new Map<string, Account>();
        for (const g of groups) {
          const r = routes[g.account.key];
          const ref = g.account.ref ?? g.account.key;
          if (!r) continue;
          if (r.to === SKIP) {
            remembered[ref] = SKIP;
            continue;
          }
          let account = r.to === NEW ? undefined : known.find((a) => a.id === r.to);
          if (account && g.account.last4 && !account.last4) {
            account = { ...account, last4: g.account.last4 };
            await db.accounts.update(account.id, { last4: g.account.last4 });
          }
          if (!account) {
            account = {
              id: newId(),
              name: r.name.trim() || tidyName(g.account.name),
              type: r.type,
              institution: r.institution.trim(),
              last4: g.account.last4,
              openingBalance: 0,
              archived: false,
              createdAt: Date.now(),
            };
            await db.accounts.add(account);
            known.push(account);
          }
          target.set(g.account.key, account);
          remembered[ref] = account.id;
        }
        let all = await db.transactions.toArray();
        let fixed = { fixed: 0, moved: 0, merged: 0 };
        const found = findEarlierImport(drafts, known, all);
        if (found.length) {
          const plan = planRepair({
            drafts,
            earlier: found,
            target: new Map([...target].map(([key, a]) => [key, a.id])),
            accounts: known,
            txns: all,
            rules,
            history: payeeHistory(all),
          });
          for (const u of plan.update) await db.transactions.update(u.id, u.changes);
          await moveLineTrades(plan.update);
          for (const m of plan.merge) await db.transactions.update(m.id, m.changes);
          await db.transactions.bulkDelete(plan.remove);
          for (const o of plan.openings) await db.accounts.update(o.accountId, { openingBalance: o.openingBalance });
          fixed = { fixed: plan.fixed, moved: plan.moved, merged: plan.merged };
          all = await db.transactions.toArray();
        }
        const added: Transaction[] = [];
        const into = new Map<string, { account: Account; added: number }>();
        let skipped = 0;
        for (const g of groups) {
          const account = target.get(g.account.key);
          if (!account) continue;
          const existing = [...all, ...added].filter((t) => t.accountId === account.id);
          const ids = new Set([...existing.flatMap(idsOf), ...appImportIds([...all, ...added])]);
          const items = skipLikely(prepareImport(account.id, g.drafts, ids, rules, { history, creditAccount: account.type === 'credit', existing }), includeLikely);
          // The same purchases from a different file format: remember this format's ids on them.
          const matched = new Map<string, string[]>();
          for (const p of items) if (p.likely && p.duplicate) matched.set(p.likely.id, [...(matched.get(p.likely.id) ?? []), p.importId]);
          for (const [id, extra] of matched) {
            const t = existing.find((x) => x.id === id);
            if (t) await db.transactions.update(id, { altImportIds: [...new Set([...(t.altImportIds ?? []), ...extra])] });
          }
          const fresh = toTransactions(account, items, 'csv', newId);
          await db.transactions.bulkAdd(fresh);
          added.push(...fresh);
          skipped += items.length - fresh.length;
          into.set(account.id, { account, added: (into.get(account.id)?.added ?? 0) + fresh.length });
        }
        // App payments that were waiting for their bank line merge into it now, as with any bank file.
        const linked = linkWaitingPayments(await db.transactions.toArray(), known);
        for (const u of linked.update) await db.transactions.update(u.id, u.changes);
        await db.transactions.bulkDelete(linked.remove);
        const removed = new Set(linked.remove);
        const kept = added.filter((r) => !removed.has(r.id));
        // Investment accounts' purchases and sales go into their holdings too.
        const trades = await tradesForImport(new Set(kept.map((r) => r.id)));
        await db.meta.put({ key: IMPORT_ROUTES, value: remembered });
        await db.csvMappings.put({ ...parsed.mapping, accountId: undefined });
        return {
          into: [...into.values()],
          // The rows just put right read as already imported now; they weren't skipped.
          skipped: Math.max(0, skipped - fixed.fixed),
          fixed,
          rows: kept,
          merged: linked.update.filter((u) => u.changes.p2p).length,
          trades: trades.notes,
        };
      });
      let byAi = 0;
      if (aiState().embed && categories && result.rows.length) {
        setBusy('ai');
        try {
          const picks = await automaticPicks(new Set(result.rows.map((r) => r.id)), await db.transactions.toArray(), categories);
          await db.transactions.bulkUpdate(picks.map((p) => ({ key: p.id, changes: { categoryId: p.categoryId, categorySource: 'ai' as const } })));
          byAi = picks.length;
        } catch {
          // The import itself worked; AI is a bonus.
        }
      }
      const n = result.rows.length;
      await recordImport(before, `${n} transaction${n === 1 ? '' : 's'} into ${result.into.length} account${result.into.length === 1 ? '' : 's'}`);
      const saved = await db.transactions.bulkGet(result.rows.map((r) => r.id));
      setDone({
        added: n,
        skipped: result.skipped,
        account: result.into[0].account,
        into: result.into,
        fixed: result.fixed,
        balanceSet: false,
        uncategorized: saved.filter((t) => t?.categoryId === 'uncategorized').length,
        byAi,
        merged: result.merged,
        waiting: 0,
        trades: result.trades,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const { uncategorized, byAi, merged, waiting } = done;
    const f = done.fixed;
    // What putting an earlier import of this file right did.
    const fixes = [
      f?.moved ? `${f.moved} moved to ${f.moved === 1 ? 'its account' : 'their accounts'}` : '',
      f?.merged ? `${f.merged} matched your bank’s own files, so ${f.merged === 1 ? 'it’s' : 'they’re'} counted once` : '',
    ]
      .filter(Boolean)
      .join(', and ');
    const onlyFixed = !done.added && !!f?.fixed;
    return (
      <Sheet title="Import" onClose={props.onClose}>
        <Empty
          icon="check"
          title={onlyFixed ? `Fixed ${f!.fixed} transaction${f!.fixed === 1 ? '' : 's'}` : `Imported ${done.added} transaction${done.added === 1 ? '' : 's'}`}
        >
          <p>
            {done.into ? (
              done.into.some((x) => x.added) && `Into ${listed(done.into.filter((x) => x.added).map((x) => `${x.account.name} (${x.added})`))}.`
            ) : (
              <>
                Into <b>{done.account.name}</b>.
              </>
            )}
            {onlyFixed && fixes && `${fixes}.`}
            {done.skipped > 0 && ` ${done.skipped} already-imported transaction${done.skipped === 1 ? ' was' : 's were'} skipped.`}
            {uncategorized > 0 && ` ${uncategorized} need a category.`}
          </p>
          {!onlyFixed && !!f?.fixed && (
            <p class="merge-note">
              <Glyph name="check" /> From an earlier import of this file, {f.fixed} transaction{f.fixed === 1 ? ' was' : 's were'} put right
              {fixes ? `: ${fixes}` : ''}.
            </p>
          )}
          {merged > 0 && (
            <p class="merge-note">
              <Glyph name="check" /> {merged} payment{merged === 1 ? '' : 's'} paid from your bank {merged === 1 ? 'was' : 'were'} matched to the bank’s own line{merged === 1 ? '' : 's'}, so {merged === 1 ? 'it isn’t' : 'they aren’t'} counted twice.
            </p>
          )}
          {waiting > 0 && (
            <p>
              {waiting} payment{waiting === 1 ? '' : 's'} paid from your bank will be matched when you import that bank’s file.
            </p>
          )}
          {done.trades?.added && (
            <p class="merge-note">
              <Glyph name="check" /> {done.trades.added}
            </p>
          )}
          {done.trades?.waiting && <p>{done.trades.waiting}</p>}
          {done.trades?.unheld && <p>{done.trades.unheld}</p>}
          {byAi > 0 && (
            <p>
              <Glyph name="spark" /> On-device AI categorized {byAi} more. They’re marked so you can check them.
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
            <button type="button" class={`button ${byAi > 0 ? '' : 'primary'}`} onClick={() => nav.showActivity(done.into ? {} : { accountId: done.account.id })}>
              View Transactions
            </button>
            <button type="button" class="button" onClick={props.onClose}>
              Done
            </button>
            <button
              type="button"
              class="button danger"
              onClick={async () => {
                const undone = await undoLastImport();
                nav.toast(undone ? 'Import undone' : 'Nothing to undo');
                props.onClose();
              }}
            >
              Undo This Import
            </button>
          </div>
        </Empty>
        <PaybackList paybacks={nudges.paybacks} />
        {done.into ? (
          <p class="section-footer intro">For an accurate net worth, check each account’s balance on its page in Net Worth.</p>
        ) : done.balanceSet ? (
          <p class="section-footer intro">✓ Balance set from {parsed?.kind === 'app' ? `${APP_NAMES[parsed.file.app]}'s statement` : 'your bank’s file'}.</p>
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
            <span class="drop-icon" aria-hidden="true">
              <Glyph name="fileIn" />
            </span>
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
            <p>Sign in at discover.com, go to your card’s activity and choose download. Pick <b>CSV</b> (or Quicken/QFX). Purchases appear as positive numbers in Discover’s CSV, and the app flips them automatically.</p>
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
            <p>Sign in at fidelity.com, open <b>Activity &amp; Orders</b>, pick a date range and use the download icon to get a CSV. With all your accounts in one file, the review lists each one and you choose where it goes; the app remembers for next time. Buys and sells are filed under Investments, and dividends count as income. Update each account’s balance by hand for an accurate net worth.</p>
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
      onSave={multi ? commitMulti : commit}
      saveLabel={busy === 'ai' ? 'Categorizing…' : busy ? 'Importing…' : multi && earlier.length && !fresh.length ? `Fix ${earlier.length}` : `Import ${fresh.length}`}
      saveDisabled={!!busy || (fresh.length === 0 && !(multi && earlier.length)) || (multi ? missingName : accountId === NEW && !newName.trim())}
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
                  ? `${parsed.format}${multi ? ` · ${groups.length} accounts` : ''}${parsed.saved ? ' · saved layout' : ''}`
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

      {groups.length === 1 && csvDrafts && <RocketRepair drafts={csvDrafts.drafts} />}

      {multi && (
        <Section
          title="Accounts in this file"
          footer={`${
            earlier.length
              ? `${earlier.length} of these transaction${earlier.length === 1 ? ' was' : 's were'} imported before with every account in one${
                  earlier.some((e) => e.flipped) ? ', and spending and income swapped' : ''
                }: importing moves each to the account chosen here and keeps your categories and notes. `
              : ''
          }Each account’s transactions go where you choose, and the next file from there goes to the same places.`}
        >
          {groups.map((g) => {
            const r = routes[g.account.key];
            if (!r) return null;
            const set = (patch: Partial<Route>) => setRoutes((all) => ({ ...all, [g.account.key]: { ...all[g.account.key], ...patch } }));
            const label = `${tidyName(g.account.name)}${g.account.last4 ? ` ••${g.account.last4}` : ''}`;
            const n = g.drafts.length;
            const fresh = routed.find((x) => x.g === g)?.items.filter((p) => !p.duplicate).length ?? 0;
            // Rows imported before with every account in one: moving here, or put right where they are.
            const mine = earlier.filter((e) => csvDrafts?.drafts[e.row].sourceAccount?.key === g.account.key);
            const moving = mine.filter((e) => e.txn.accountId !== r.to).length;
            const fixing = mine.length - moving;
            const count =
              r.to === SKIP
                ? `${n} transaction${n === 1 ? '' : 's'}, not imported`
                : fresh || moving || fixing
                  ? [`${n} transaction${n === 1 ? '' : 's'}`, fresh && `${fresh} new`, moving && `${moving} to move here`, fixing && `${fixing} to fix`]
                      .filter(Boolean)
                      .join(' · ')
                  : `${n} transaction${n === 1 ? '' : 's'}, all imported already`;
            return (
              <>
                {/* The account in the file on top, the account its rows go into below: both fit at phone width. */}
                <label class="field route">
                  <span class="route-from">
                    {label}
                    <span class="field-hint">{count}</span>
                  </span>
                  <span class="field-label">Into</span>
                  <span class="field-control">
                    <select value={r.to} aria-label={`Account for ${label}`} onChange={(e) => set({ to: (e.target as HTMLSelectElement).value })}>
                      {accountList.map((a) => (
                        <option value={a.id}>{a.name}</option>
                      ))}
                      <option value={NEW}>＋ New account…</option>
                      <option value={SKIP}>Don’t import</option>
                    </select>
                  </span>
                </label>
                {r.to === NEW && (
                  <div class="route-new" role="group" aria-label={`New account for ${label}`}>
                    <Field label="Name">
                      <input value={r.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
                    </Field>
                    <Field label="Type">
                      <select value={r.type} onChange={(e) => set({ type: (e.target as HTMLSelectElement).value as AccountType })}>
                        {ACCOUNT_TYPES.map((t) => (
                          <option value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
              </>
            );
          })}
        </Section>
      )}

      {!multi && (
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
      )}

      {m && (
        <Section title="Columns" footer="Purchases should show as negative amounts in the preview below. If they’re positive, turn on Flip signs.">
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
          title={`Already in ${multi ? 'your accounts' : (accounts?.find((a) => a.id === accountId)?.name ?? 'this account')}`}
          footer="Same amount and store within a few days of a transaction you imported from a different file (for example a CSV before, a QFX now). They’re skipped so nothing counts twice."
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
                  {p.group ? `${fromLabel(p.group)} · ` : ''}
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
