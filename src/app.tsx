import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';
import { db, eraseEverything } from './db';
import { NavContext, type ActivityFilter, type Nav, type Page, type Tab } from './nav';
import type { PasscodeRecord } from './lib/lock';
import { LockScreen } from './screens/Lock';
import { Home } from './screens/Home';
import { Activity } from './screens/Activity';
import { Accounts } from './screens/Accounts';
import { Recurring } from './screens/Recurring';
import { SettingsSheet } from './screens/Settings';
import { Browse } from './screens/Browse';
import { Spending } from './screens/Spending';
import { MoneyHealth } from './screens/MoneyHealth';
import { Search } from './screens/Search';
import { Glyph, type GlyphName } from './components/icons';
import { Ambient } from './components/Ambient';

const TABS: { id: Tab; label: string; glyph: GlyphName }[] = [
  { id: 'home', label: 'Today', glyph: 'today' },
  { id: 'activity', label: 'Activity', glyph: 'list' },
  { id: 'browse', label: 'Browse', glyph: 'grid' },
];

/** Screens opened from Browse: Browse stays lit in the tab bar. */
const PAGES: Page[] = ['spending', 'recurring', 'accounts', 'health'];
const isPage = (t: Tab | Page): t is Page => (PAGES as string[]).includes(t);

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
  const [tab, setTab] = useState<Tab | Page>('home');
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

  // Registers the offline service worker; updates install and reload automatically.
  useRegisterSW();

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
    openSettings: () => {
      const id = nextId.current++;
      setSheets((s) => [...s, { id, render: (close) => <SettingsSheet onClose={close} /> }]);
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
    return (
      <>
        <Ambient tone="lock" />
        <LockScreen record={lockState.passcode} onUnlock={() => setLocked(false)} onReset={eraseEverything} />
      </>
    );
  }

  return (
    <NavContext.Provider value={nav}>
      <Ambient tone={tab} />
      <main class="screen">
        {isPage(tab) && (
          <button type="button" class="back-pill" onClick={() => nav.setTab('browse')}>
            <Glyph name="chevronLeft" />
            Browse
          </button>
        )}
        {tab === 'home' && <Home />}
        {tab === 'activity' && <Activity />}
        {tab === 'browse' && <Browse />}
        {tab === 'search' && <Search />}
        {tab === 'spending' && <Spending />}
        {tab === 'health' && <MoneyHealth />}
        {tab === 'recurring' && <Recurring />}
        {tab === 'accounts' && <Accounts />}
      </main>
      <nav class="tabbar-wrap" aria-label="Main">
        <div class="tabbar">
          {TABS.map((t) => {
            const on = tab === t.id || (t.id === 'browse' && isPage(tab));
            return (
              <button type="button" class={on ? 'active' : ''} aria-current={on ? 'page' : undefined} onClick={() => nav.setTab(t.id)}>
                <span class="tab-icon" aria-hidden="true">
                  <Glyph name={t.glyph} />
                </span>
                <span class="tab-label">{t.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          class={`tab-search ${tab === 'search' ? 'active' : ''}`}
          aria-label="Search"
          aria-current={tab === 'search' ? 'page' : undefined}
          onClick={() => nav.setTab('search')}
        >
          <Glyph name="search" />
        </button>
      </nav>
      {sheets.map((s) => (
        <div key={s.id}>{s.render(() => setSheets((all) => all.filter((x) => x.id !== s.id)))}</div>
      ))}
      {toastMsg && (
        <div class="toast" role="status">
          {toastMsg}
        </div>
      )}
    </NavContext.Provider>
  );
}
