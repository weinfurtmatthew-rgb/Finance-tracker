import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';

export type Tab = 'home' | 'activity' | 'recurring' | 'accounts' | 'settings';

export interface ActivityFilter {
  accountId?: string;
  categoryId?: string;
  month?: string;
}

export interface Nav {
  tab: Tab;
  setTab(tab: Tab): void;
  /** Open a full-screen sheet on top of everything. */
  present(render: (close: () => void) => ComponentChildren): void;
  showActivity(filter: ActivityFilter): void;
  activityFilter: ActivityFilter;
  setActivityFilter(filter: ActivityFilter): void;
  toast(message: string): void;
}

export const NavContext = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavContext);
