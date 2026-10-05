/**
 * App updates without interrupting you. A new version downloads in the background and waits; it's put
 * in place (a quick reload) only at a moment you won't notice: right after the app opens, or when you
 * leave it with nothing open on screen. A form you're filling in is never reloaded away. If the
 * moment never comes, the new version takes over the next time the app starts from scratch.
 */
import { useEffect, useRef } from 'preact/hooks';
import { useRegisterSW } from 'virtual:pwa-register/preact';

const RESUME_KEY = 'resumeScreen';
/** How soon after opening an update can apply straight away (you haven't started anything yet). */
const AT_LAUNCH_MS = 6000;

/** The screen to come back to after an update's reload (once). */
export function resumeScreen<T extends string>(valid: readonly T[]): T | undefined {
  try {
    const s = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return valid.find((v) => v === s);
  } catch {
    return undefined;
  }
}

/** `busy`: something is open (a sheet, the lock screen) that a reload would throw away. */
export function useQuietUpdates(busy: boolean, screen: string) {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW();
  const state = useRef({ busy, screen });
  state.current = { busy, screen };

  useEffect(() => {
    if (!ready) return;
    const apply = () => {
      try {
        sessionStorage.setItem(RESUME_KEY, state.current.screen);
      } catch {
        // Private mode: the app just opens on Today.
      }
      void updateServiceWorker(true);
    };
    if (performance.now() < AT_LAUNCH_MS && !state.current.busy) {
      apply();
      return;
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && !state.current.busy) apply();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ready]);
}
