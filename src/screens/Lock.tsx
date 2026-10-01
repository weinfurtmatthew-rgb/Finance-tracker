import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { checkPasscode, createPasscode, type PasscodeRecord } from '../lib/lock';
import { ActionSheet } from '../components/ui';
import { Glyph } from '../components/icons';

const LENGTH = 6;

function Keypad(props: { title: string; subtitle?: string; error?: string; onComplete: (code: string) => void; busy?: boolean; footer?: preact.ComponentChildren }) {
  const [code, setCode] = useState('');
  useEffect(() => {
    if (code.length === LENGTH) {
      props.onComplete(code);
      setCode('');
    }
  }, [code]);
  // Listen before the keypad is drawn, so digits typed the moment it appears aren't lost.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setCode((c) => (c.length < LENGTH ? c + e.key : c));
      else if (e.key === 'Backspace') setCode((c) => c.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const press = (d: string) => setCode((c) => (c.length < LENGTH ? c + d : c));
  return (
    <div class="lock">
      <div class="lock-top">
        <div class="lock-icon" aria-hidden="true">
          <Glyph name="lock" />
        </div>
        <h1>{props.title}</h1>
        {props.subtitle && <p class="muted">{props.subtitle}</p>}
        <div class={`dots ${props.error ? 'shake' : ''}`} aria-label={`${code.length} of ${LENGTH} digits entered`}>
          {Array.from({ length: LENGTH }, (_, i) => (
            <span class={i < code.length ? 'filled' : ''} />
          ))}
        </div>
        <p class="lock-error" role="alert">
          {props.busy ? 'Checking…' : props.error ?? ' '}
        </p>
      </div>
      <div class="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button type="button" class="key" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" class="key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" class="key key-text" aria-label="Delete" onClick={() => setCode((c) => c.slice(0, -1))}>
          ⌫
        </button>
      </div>
      {props.footer}
    </div>
  );
}

export function LockScreen(props: { record: PasscodeRecord; onUnlock: () => void; onReset: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <>
      <Keypad
        title="Enter Passcode"
        error={error}
        busy={busy}
        onComplete={async (code) => {
          setBusy(true);
          const ok = await checkPasscode(code, props.record);
          setBusy(false);
          if (ok) props.onUnlock();
          else {
            setAttempts((a) => a + 1);
            setError('Wrong passcode');
          }
        }}
        footer={
          attempts >= 3 && (
            <button type="button" class="link lock-forgot" onClick={() => setConfirmReset(true)}>
              Forgot passcode?
            </button>
          )
        }
      />
      {confirmReset && (
        <ActionSheet
          title="Erase everything?"
          message="The passcode can't be recovered. The only way back in is to erase all data on this device. You can then restore from a backup file."
          actions={[{ label: 'Erase All Data', destructive: true, onClick: props.onReset }]}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </>
  );
}

/** Two-step "enter, then confirm" flow for creating or changing the passcode. */
export function SetPasscode(props: { onDone: (record: PasscodeRecord) => void }) {
  const [first, setFirst] = useState<string>();
  const [error, setError] = useState<string>();
  return (
    <Keypad
      key={first ? 'confirm' : 'first'}
      title={first ? 'Confirm Passcode' : 'Choose a Passcode'}
      subtitle={first ? 'Enter it again' : `${LENGTH} digits. There is no way to recover it, so make it one you'll remember.`}
      error={error}
      onComplete={async (code) => {
        if (!first) {
          setFirst(code);
          setError(undefined);
        } else if (code === first) {
          props.onDone(await createPasscode(code));
        } else {
          setFirst(undefined);
          setError("Passcodes didn't match. Try again.");
        }
      }}
    />
  );
}
