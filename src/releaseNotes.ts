/**
 * What's new, newest first. Add an entry with each change people would notice; the newest one is shown
 * once after the update arrives (and any they missed since the last one they saw). Keep each line to
 * what it means for the person using the app, in plain words.
 */
export interface Release {
  /** Unique and never reused: the date it shipped, with a letter if there are two in a day. */
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const RELEASES: Release[] = [
  {
    id: '2026-10-05b',
    date: 'October 5, 2026',
    title: 'A simpler app',
    items: [
      'Today is about half as long: your recent transactions, money on hand and bills coming up, then one short To do list.',
      'Browse groups everything into Money, Plan & Look Back, and People & Trips. Show it as a list or as tiles with the button at the top.',
      'Money Health and Year in Review are pinned in Browse. Money owed to you is in People.',
      'Settings is just setup now, with Backup first.',
      'The same names everywhere, like Bills & Subscriptions and Trips & Tags.',
    ],
  },
  {
    id: '2026-10-05',
    date: 'October 5, 2026',
    title: 'Numbers you can trust',
    items: [
      'Today, Spending and Activity now agree: spent is everyday spending plus bills, the same everywhere.',
      'Rent, utilities and other bills count as bills right away, before you confirm anything.',
      'Changed your mind about an import? Undo it from the import screen or Settings → Backup.',
      'Updates wait for a quiet moment instead of reloading while you’re in the middle of something.',
      'Money Health says “not enough info” instead of scoring what it can’t see.',
      'Switching screens and searching are several times faster with years of history.',
    ],
  },
  {
    id: '2026-10-02',
    date: 'October 2, 2026',
    title: 'A livelier app, made yours',
    items: [
      'Numbers count up, charts draw in, and a small celebration marks a goal reached or a month on budget. Reduce Motion in iOS settings keeps it calm.',
      'Pick an accent color in Settings → Appearance.',
      'Activity’s quick filters moved into one Filters button.',
      'Backups can be protected with a password, and checked before you rely on them.',
    ],
  },
];

/** The releases someone hasn't seen yet: those newer than `seen` (just the newest when unknown). */
export function unseenReleases(seen: string | undefined): Release[] {
  if (!seen) return RELEASES.slice(0, 1);
  const i = RELEASES.findIndex((r) => r.id === seen);
  return i === -1 ? RELEASES.slice(0, 1) : RELEASES.slice(0, i);
}
