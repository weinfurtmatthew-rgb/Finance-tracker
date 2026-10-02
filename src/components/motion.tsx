import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';

/**
 * Motion helpers. Things build in (numbers count up, charts draw) the first time a screen is seen in a
 * visit, and in every sheet; after that they just appear, so moving around never feels slow. Reduce
 * Motion turns all of it off.
 */

/** True inside a screen's first view this visit, and inside sheets. */
export const IntroContext = createContext(false);

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const ease = (k: number) => 1 - (1 - k) ** 3;

/** A number that counts up from zero on a first view, and rolls to its new value whenever it changes. */
export function useCountUp(value: number, ms = 750): number {
  const intro = useContext(IntroContext);
  const [shown, setShown] = useState(() => (intro && !reducedMotion() ? 0 : value));
  const current = useRef(shown);
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    if (reducedMotion()) {
      current.current = value;
      setShown(value);
      return;
    }
    let raf = 0;
    let start: number | undefined;
    const step = (t: number) => {
      start ??= t;
      const k = Math.min(1, (t - start) / ms);
      current.current = from + (value - from) * ease(k);
      setShown(current.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/** `value` shown with `format`, counting up (see useCountUp). */
export function CountUp(props: { value: number; format: (n: number) => string; class?: string }) {
  const shown = useCountUp(props.value);
  return <span class={props.class}>{props.format(Math.round(shown))}</span>;
}
