import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

/** The tab bar: Today, Activity, Browse, and Search on its own button. */
export type Tab = 'home' | 'activity' | 'browse' | 'search';
/** Screens opened from Browse: Browse stays selected and they get a back button. */
export type Page = 'recurring' | 'accounts';

export interface ActivityFilter {
  accountId?: string;
  categoryId?: string;
  month?: string;
  tag?: string;
}

export interface Nav {
  tab: Tab | Page;
  setTab(tab: Tab | Page): void;
  /** Settings open as a sheet from the profile button. */
  openSettings(): void;
  /** Open a full-screen sheet on top of everything. */
  present(render: (close: () => void) => ComponentChildren): void;
  showActivity(filter: ActivityFilter): void;
  activityFilter: ActivityFilter;
  setActivityFilter(filter: ActivityFilter): void;
  toast(message: string): void;
}

export const NavContext = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavContext);
