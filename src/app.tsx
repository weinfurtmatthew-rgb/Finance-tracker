import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { db, eraseEverything } from './db';
import { NavContext, type ActivityFilter, type Nav, type Tab } from './nav';
import type { PasscodeRecord } from './lib/lock';
import { LockScreen } from './screens/Lock';
import { Home } from './screens/Home';
import { Activity } from './screens/Activity';
import { Accounts } from './screens/Accounts';
import { Recurring } from './screens/Recurring';
import { Settings } from './screens/Settings';
import { Icons } from './components/icons';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'accounts', label: 'Net Worth' },
  { id: 'settings', label: 'Settings' },
];

interface SheetEntry {
  id: number;
  render: (close: () => void) => ComponentChildren;
}

export function App() {
  const lockState = useLiveQuery(async () => ({
    passcode: (await db.meta.get('passcode'))?.value as PasscodeRecord | undefined,
    autoLockMinutes: ((await db.meta.get('autoLockMinutes'))?.value as number | undefined) ?? 1,
  }));
  const [locked, setLocked] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>({});
  const [sheets, setSheets] = useState<SheetEntry[]>([]);
  const [toastMsg, setToastMsg] = useState<string>();
  const hiddenAt = useRef<number | null>(null);
  const nextId = useRef(1);

  // Lock on launch when a passcode is set.
  useEffect(() => {
    if (lockState && locked === null) setLocked(!!lockState.passcode);
  }, [lockState, locked]);

  // Auto-lock after the app has been in the background for a while.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now();
      else if (hiddenAt.current != null && lockState?.passcode) {
        const away = Date.now() - hiddenAt.current;
        if (away >= lockState.autoLockMinutes * 60_000) setLocked(true);
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [lockState]);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    setTimeout(() => setToastMsg((m) => (m === message ? undefined : m)), 2600);
  }, []);

  const nav: Nav = {
    tab,
    setTab: (t) => {
      setTab(t);
      window.scrollTo(0, 0);
    },
    present: (render) => {
      const id = nextId.current++;
      setSheets((s) => [...s, { id, render }]);
    },
    showActivity: (filter) => {
      setActivityFilter(filter);
      setSheets([]);
      setTab('activity');
      window.scrollTo(0, 0);
    },
    activityFilter,
    setActivityFilter,
    toast,
  };

  if (!lockState || locked === null) return <div class="splash" />;
  if (locked && lockState.passcode) {
    return <LockScreen record={lockState.passcode} onUnlock={() => setLocked(false)} onReset={eraseEverything} />;
  }

  return (
    <NavContext.Provider value={nav}>
      <main class="screen">
        {tab === 'home' && <Home />}
        {tab === 'activity' && <Activity />}
        {tab === 'recurring' && <Recurring />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'settings' && <Settings />}
      </main>
      <nav class="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button type="button" class={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => nav.setTab(t.id)}>
            <span class="tab-icon" aria-hidden="true">
              {Icons[t.id]()}
            </span>
            <span class="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>
      {sheets.map((s) => (
        <div key={s.id}>{s.render(() => setSheets((all) => all.filter((x) => x.id !== s.id)))}</div>
      ))}
      {needRefresh && (
        <div class="update-banner">
          <span>A new version is ready.</span>
          <button type="button" class="link strong" onClick={() => updateServiceWorker(true)}>
            Update
          </button>
        </div>
      )}
      {toastMsg && (
        <div class="toast" role="status">
          {toastMsg}
        </div>
      )}
    </NavContext.Provider>
  );
}
