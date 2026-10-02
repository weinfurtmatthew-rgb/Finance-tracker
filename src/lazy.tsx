import { lazy } from 'preact/compat';

/**
 * Big sheets that most visits never open load on first use (they're still cached for offline use by
 * the service worker). Rendered inside the app's <Suspense> boundaries.
 */
export const ImportFlow = lazy(() => import('./screens/Import').then((m) => ({ default: m.ImportFlow })));
export const Plan = lazy(() => import('./screens/plan/Plan').then((m) => ({ default: m.Plan })));
export const SettingsSheet = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsSheet })));
