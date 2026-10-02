import { useState } from 'preact/hooks';
import { db, setMeta } from '../db';
import { useMeta } from '../hooks';
import { useNav, type Nav } from '../nav';
import { checkBackup, exportBackup, type BackupCheck } from '../lib/backup';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../lib/backupCrypto';
import { saveFile } from '../lib/files';
import { Field, Row, Section, Sheet, Toggle } from '../components/ui';
import { Glyph } from '../components/icons';

const MIN_PASSWORD = 8;

interface Ready {
  name: string;
  file: string;
  check: BackupCheck;
  protectedFile: boolean;
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;

/**
 * Making a backup: optionally protected with a password, then read back and compared with what's in the
 * app before it's offered to save, so a saved backup is known to restore.
 */
export function BackupSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const remembered = useMeta<boolean>('backupProtect');
  const [protect, setProtect] = useState<boolean>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState<Ready>();
  const [error, setError] = useState<string>();
  const on = protect ?? remembered ?? false;
  const passwordOk = !on || (password.length >= MIN_PASSWORD && password === confirm);

  const create = async () => {
    setWorking(true);
    setError(undefined);
    try {
      const [plain, accounts, transactions] = await Promise.all([exportBackup(db), db.accounts.count(), db.transactions.count()]);
      let file = plain;
      let readBack = plain;
      if (on) {
        const sealed = await encryptBackup(plain, password);
        file = sealed.file;
        readBack = await decryptBackup(file, '', sealed.key);
      }
      // Read it back the way a restore would, and make sure everything made it in.
      const check = checkBackup(readBack);
      if (readBack !== plain || check.accounts !== accounts || check.transactions !== transactions) throw new Error("The backup didn't match your data. Please try again.");
      await setMeta('backupProtect', on);
      const stamp = new Date().toISOString().slice(0, 10);
      setReady({ name: `finance-backup-${stamp}${on ? '-protected' : ''}.json`, file, check, protectedFile: on });
    } catch (e) {
      setError((e as Error).message);
    }
    setWorking(false);
  };

  const save = async () => {
    if (!ready) return;
    try {
      await saveFile(ready.name, ready.file, 'application/json');
      await setMeta('lastBackupAt', Date.now());
      nav.toast('Backup saved');
      props.onClose();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`Couldn't save: ${(e as Error).message}`);
    }
  };

  return (
    <Sheet title="Back Up" onClose={props.onClose}>
      {ready ? (
        <>
          <section class="card backup-ready" aria-live="polite">
            <span class="backup-ready-icon" aria-hidden="true">
              <Glyph name="check" />
            </span>
            <strong>Backup ready and checked</strong>
            <span class="card-sub">
              {plural(ready.check.accounts, 'account')} and {plural(ready.check.transactions, 'transaction')}
              {ready.protectedFile ? ', protected with your password.' : '.'} It was read back and matches what's in the app.
            </span>
          </section>
          <button type="button" class="button primary wide" onClick={save}>
            Save to Files…
          </button>
          <p class="section-footer">Choose “Save to Files” and pick iCloud Drive (or another folder that isn't only on this phone).</p>
        </>
      ) : (
        <>
          <Section footer="A backup is one file with everything in the app except your passcode. Keep it somewhere other than this phone, like iCloud Drive.">
            <Toggle label="Protect with a password" checked={on} onChange={setProtect} />
          </Section>
          {on && (
            <Section
              footer={
                <>
                  <strong>Write this password down.</strong> If you forget it, the backup can't be opened, by you or anyone else. It isn't saved
                  anywhere.
                </>
              }
            >
              <Field label="Password" hint={password && password.length < MIN_PASSWORD ? `At least ${MIN_PASSWORD} characters.` : undefined}>
                <input type="password" autocomplete="new-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="Again" hint={confirm && confirm !== password ? "The passwords don't match." : undefined}>
                <input type="password" autocomplete="new-password" value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} />
              </Field>
            </Section>
          )}
          <button type="button" class="button primary wide" disabled={!passwordOk || working} onClick={create}>
            {working ? (on ? 'Encrypting and checking…' : 'Checking…') : 'Create Backup'}
          </button>
        </>
      )}
      {error && (
        <p class="section-footer danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** Asks for a backup's password; `open` returns an error to show, or nothing when it worked. */
function PasswordSheet(props: { onClose: () => void; open: (password: string) => Promise<string | void> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);
  const submit = async () => {
    setWorking(true);
    const problem = await props.open(password);
    setWorking(false);
    if (problem) setError(problem);
    else props.onClose();
  };
  return (
    <Sheet title="Protected Backup" onClose={props.onClose} onSave={submit} saveLabel={working ? 'Opening…' : 'Open'} saveDisabled={!password || working}>
      <Section footer="This backup was saved with a password. Enter it to open the file.">
        <Field label="Password">
          <input
            type="password"
            autocomplete="current-password"
            autoFocus
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && password && void submit()}
          />
        </Field>
      </Section>
      {error && (
        <p class="section-footer danger" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

/** The backup text in a picked file, asking for the password first when it's protected. */
export async function openBackupFile(nav: Nav, file: File, then: (text: string) => void) {
  const text = await file.text();
  if (!isEncryptedBackup(text)) return then(text);
  nav.present((close) => (
    <PasswordSheet
      onClose={close}
      open={async (password) => {
        try {
          const plain = await decryptBackup(text, password);
          then(plain);
        } catch (e) {
          return (e as Error).message;
        }
      }}
    />
  ));
}

/** What a backup file holds, checked without changing anything. */
export function BackupCheckSheet(props: { check: BackupCheck; onClose: () => void }) {
  const { check } = props;
  const ok = check.problems.length === 0;
  return (
    <Sheet title="Backup Check" onClose={props.onClose}>
      <section class={`card backup-ready ${ok ? '' : 'has-problems'}`}>
        <span class="backup-ready-icon" aria-hidden="true">
          <Glyph name={ok ? 'check' : 'alert'} />
        </span>
        <strong>{ok ? 'This backup can be restored' : 'This backup has problems'}</strong>
        <span class="card-sub">Nothing in the app was changed.</span>
      </section>
      <Section>
        <Row title="Made" detail={new Date(check.exportedAt).toLocaleString()} chevron={false} />
        <Row title="Accounts" detail={check.accounts.toLocaleString()} chevron={false} />
        <Row title="Transactions" detail={check.transactions.toLocaleString()} chevron={false} />
      </Section>
      {!ok && (
        <section class="section">
          <h3 class="section-title">Problems</h3>
          <ul class="card backup-problems">
            {check.problems.map((p) => (
              <li>{p}</li>
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}
