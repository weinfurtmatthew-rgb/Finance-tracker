/** The app's accent color: buttons, links, the selected tab and highlights. Blue unless you pick another. */
export const ACCENTS = [
  { id: 'blue', label: 'Blue' },
  { id: 'green', label: 'Green' },
  { id: 'violet', label: 'Violet' },
  { id: 'orange', label: 'Orange' },
  { id: 'pink', label: 'Pink' },
  { id: 'graphite', label: 'Graphite' },
] as const;

export type Accent = (typeof ACCENTS)[number]['id'];

const KEY = 'accent';

/** Colors the app. Also remembered outside the database so the first frame already has the right color. */
export function applyAccent(accent: Accent | undefined) {
  const a = accent && accent !== 'blue' ? accent : '';
  if (a) document.documentElement.dataset.accent = a;
  else delete document.documentElement.dataset.accent;
  try {
    if (a) localStorage.setItem(KEY, a);
    else localStorage.removeItem(KEY);
  } catch {
    // Storage can be unavailable (private browsing); the database setting still applies once loaded.
  }
}

/** Before the first render: the accent remembered from last time. */
export function applySavedAccent() {
  try {
    const a = localStorage.getItem(KEY);
    if (a) document.documentElement.dataset.accent = a;
  } catch {
    // See above.
  }
}

/** A pay-what-you-want link for people who'd like to chip in (set VITE_SUPPORT_URL when building; empty hides it). */
export const SUPPORT_URL: string = (import.meta.env.VITE_SUPPORT_URL as string | undefined) ?? '';
