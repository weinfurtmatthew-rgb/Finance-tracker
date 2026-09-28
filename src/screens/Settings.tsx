import { useEffect, useState } from 'preact/hooks';
import { db, deleteMeta, eraseEverything, setMeta } from '../db';
import { useCategories, useMeta, useRules, useTransactions } from '../hooks';
import { useNav } from '../nav';
import type { PasscodeRecord } from '../lib/lock';
import { exportBackup, restoreBackup, summarizeBackup, type BackupSummary } from '../lib/backup';
import { ActionSheet, Row, Section, Sheet } from '../components/ui';
import { SetPasscode } from './Lock';
import { CategoriesSheet } from './Categories';
import { RulesSheet } from './Rules';

const AUTO_LOCK = [
  { minutes: 0, label: 'Immediately' },
  { minutes: 1, label: 'After 1 minute' },
  { minutes: 5, label: 'After 5 minutes' },
  { minutes: 15, label: 'After 15 minutes' },
];

async function saveFile(name: string, text: string, type: string) {
  const file = new File([text], name, { type });
  // On iPhone the share sheet offers "Save to Files", which is the most reliable option.
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Settings() {
  const nav = useNav();
  const passcode = useMeta<PasscodeRecord>('passcode');
  const autoLock = useMeta<number>('autoLockMinutes') ?? 1;
  const lastBackup = useMeta<number>('lastBackupAt');
  const categories = useCategories();
  const rules = useRules();
  const txns = useTransactions();
  const [ask, setAsk] = useState<null | 'remove-passcode' | 'erase' | 'autolock' | { restore: string; summary: BackupSummary }>(null);
  const [persisted, setPersisted] = useState<boolean>();
  const [usage, setUsage] = useState<string>();

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
    navigator.storage?.estimate?.().then((e) => e.usage != null && setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`)).catch(() => {});
  }, [txns.length]);

  const setPasscode = () =>
    nav.present((close) => (
      <Sheet title="Passcode" onClose={close}>
        <SetPasscode
          onDone={async (record) => {
            await setMeta('passcode', record);
            nav.toast('Passcode set');
            close();
          }}
        />
      </Sheet>
    ));

  const backup = async () => {
    try {
      const text = await exportBackup(db);
      const stamp = new Date().toISOString().slice(0, 10);
      await saveFile(`finance-backup-${stamp}.json`, text, 'application/json');
      await setMeta('lastBackupAt', Date.now());
      nav.toast('Backup saved');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') nav.toast(`Backup failed: ${(e as Error).message}`);
    }
  };

  const pickRestore = async (file: File) => {
    try {
      const text = await file.text();
      setAsk({ restore: text, summary: summarizeBackup(text) });
    } catch (e) {
      nav.toast((e as Error).message);
    }
  };

  const exportCsv = async () => {
    const accounts = new Map((await db.accounts.toArray()).map((a) => [a.id, a.name]));
    const cats = new Map(categories.map((c) => [c.id, c.name]));
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = ['Date,Account,Payee,Category,Amount,Notes,Bank Description'];
    for (const t of [...txns].reverse()) {
      lines.push([t.date, accounts.get(t.accountId) ?? '', t.payee, cats.get(t.categoryId) ?? '', (t.amount / 100).toFixed(2), t.notes, t.description].map(esc).join(','));
    }
    await saveFile(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv').catch(() => {});
  };

  return (
    <>
      <header class="large-title">
        <h1>Settings</h1>
      </header>

      <Section title="Security" footer="The passcode protects this app when someone else has your unlocked phone. There is no way to recover a forgotten passcode.">
        {passcode ? (
          <>
            <Row title="Change Passcode" onClick={setPasscode} />
            <Row title="Lock" detail={AUTO_LOCK.find((a) => a.minutes === autoLock)?.label} onClick={() => setAsk('autolock')} />
            <Row title="Turn Passcode Off" danger onClick={() => setAsk('remove-passcode')} chevron={false} />
          </>
        ) : (
          <Row title="Turn Passcode On" onClick={setPasscode} />
        )}
      </Section>

      <Section title="Organize">
        <Row title="Categories" detail={categories.length} onClick={() => nav.present((close) => <CategoriesSheet onClose={close} />)} />
        <Row title="Rules" subtitle="Auto-rename and categorize imports" detail={rules.length} onClick={() => nav.present((close) => <RulesSheet onClose={close} />)} />
      </Section>

      <Section
        title="Backup"
        footer={
          <>
            Your data exists only on this phone. If you delete the app from your Home Screen, the data goes with it. Save a backup to Files (or iCloud Drive) regularly.
            {lastBackup ? ` Last backup: ${new Date(lastBackup).toLocaleDateString()}.` : ' No backup yet.'}
          </>
        }
      >
        <Row title="Save Backup…" onClick={backup} />
        <label class="row" role="button">
          <span class="row-main">
            <span class="row-title">Restore from Backup…</span>
          </span>
          <span class="chevron">›</span>
          <input
            type="file"
            class="hidden-file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) pickRestore(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
        </label>
        <Row title="Export Transactions as CSV…" onClick={exportCsv} />
      </Section>

      <Section title="Storage" footer="Stored in this browser's private database on your iPhone. Nothing is uploaded; the app has no server.">
        <Row title="Transactions" detail={txns.length.toLocaleString()} chevron={false} />
        {usage && <Row title="Space used" detail={usage} chevron={false} />}
        <Row title="Protected from cleanup" detail={persisted == null ? '—' : persisted ? 'Yes' : 'Not granted'} chevron={false} />
        <Row title="Erase All Data" danger chevron={false} onClick={() => setAsk('erase')} />
      </Section>

      <p class="section-footer center">Finance Tracker · private &amp; on-device</p>

      {ask === 'autolock' && (
        <ActionSheet
          title="Require passcode"
          actions={AUTO_LOCK.map((a) => ({
            label: a.label,
            bold: a.minutes === autoLock,
            onClick: async () => {
              await setMeta('autoLockMinutes', a.minutes);
              setAsk(null);
            },
          }))}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'remove-passcode' && (
        <ActionSheet
          message="Anyone with your unlocked phone will be able to open the app."
          actions={[
            {
              label: 'Turn Passcode Off',
              destructive: true,
              onClick: async () => {
                await deleteMeta('passcode');
                setAsk(null);
                nav.toast('Passcode off');
              },
            },
          ]}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask === 'erase' && (
        <ActionSheet
          title="Erase all data?"
          message="All accounts, transactions, rules and settings will be permanently deleted from this phone."
          actions={[{ label: 'Erase All Data', destructive: true, onClick: eraseEverything }]}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask && typeof ask === 'object' && (
        <ActionSheet
          title="Replace everything with this backup?"
          message={`Backup from ${new Date(ask.summary.exportedAt).toLocaleString()} with ${ask.summary.accounts} accounts and ${ask.summary.transactions} transactions. Everything currently in the app will be replaced.`}
          actions={[
            {
              label: 'Restore Backup',
              destructive: true,
              onClick: async () => {
                try {
                  await restoreBackup(db, ask.restore);
                  nav.toast('Backup restored');
                } catch (e) {
                  nav.toast(`Restore failed: ${(e as Error).message}`);
                }
                setAsk(null);
              },
            },
          ]}
          onCancel={() => setAsk(null)}
        />
      )}
    </>
  );
}
