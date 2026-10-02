import { useEffect } from 'preact/hooks';
import { Glyph } from './icons';

const HUES = ['green', 'blue', 'yellow', 'magenta', 'aqua', 'orange'];

/** A small moment for a good thing (a goal reached, a month under budget): a burst and a line of text. */
export function Celebration(props: { title: string; sub?: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(props.onDone, 3200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div class="celebrate" role="status">
      <div class="celebrate-card">
        <span class="celebrate-icon" aria-hidden="true">
          <span class="celebrate-burst">
            {HUES.concat(HUES).map((h, i) => (
              <span style={{ '--a': `${i * 30 + 15}deg`, background: `var(--hue-${h})` }} />
            ))}
          </span>
          <Glyph name="check" />
        </span>
        <span class="celebrate-text">
          <strong>{props.title}</strong>
          {props.sub && <span>{props.sub}</span>}
        </span>
      </div>
    </div>
  );
}
