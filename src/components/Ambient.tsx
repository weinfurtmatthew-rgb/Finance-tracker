import type { Page, Tab } from '../nav';

/**
 * The soft light behind the glass: a few still, blurred glows in colors that fit the screen, and a
 * fine grain so large areas don't look like flat plastic. It stays put while the page scrolls, so the
 * cards slide over it.
 */
export type Tone = Tab | Page | 'lock';

type Glow = [left: number, top: number, size: number, color: string, strength: number];

/** Glows laid out on a 390 × 844 phone screen (left scales with the width). */
const TONES: Record<Tone, Glow[]> = {
  home: [
    [170, -140, 460, 'var(--status-good)', 0.55],
    [-190, 330, 430, 'var(--hue-blue)', 0.45],
    [190, 600, 400, 'var(--hue-orange)', 0.36],
  ],
  activity: [
    [150, -160, 460, 'var(--hue-blue)', 0.45],
    [-210, 520, 420, 'var(--hue-aqua)', 0.35],
  ],
  spending: [
    [110, -150, 500, 'var(--hue-orange)', 0.5],
    [-220, 520, 420, 'var(--hue-yellow)', 0.28],
  ],
  recurring: [
    [150, -150, 460, 'var(--hue-violet)', 0.42],
    [-200, 520, 420, 'var(--hue-yellow)', 0.3],
  ],
  accounts: [
    [-170, -120, 440, 'var(--hue-aqua)', 0.42],
    [190, 420, 420, 'var(--hue-blue)', 0.34],
  ],
  browse: [
    [-180, -120, 440, 'var(--hue-orange)', 0.4],
    [190, 120, 420, 'var(--hue-aqua)', 0.38],
    [-200, 560, 420, 'var(--hue-violet)', 0.3],
  ],
  search: [
    [180, -160, 380, 'var(--hue-aqua)', 0.3],
    [-70, 480, 540, 'var(--hue-blue)', 0.45],
  ],
  lock: [
    [-40, -110, 520, 'var(--hue-blue)', 0.45],
    [180, 560, 420, 'var(--hue-violet)', 0.3],
  ],
};

let grainUrl: string | null | undefined;

/** A small tile of gray noise, made once. */
function grain(): string | null {
  if (grainUrl !== undefined) return grainUrl;
  grainUrl = null;
  try {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() + Math.random()) * 127.5;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      grainUrl = canvas.toDataURL('image/png');
    }
  } catch {
    // No canvas: the glass works without grain.
  }
  return grainUrl;
}

export function Ambient(props: { tone: Tone }) {
  const url = grain();
  return (
    <div class="ambient" aria-hidden="true">
      <div class="ambient-frame">
        {TONES[props.tone].map(([left, top, size, color, strength], i) => (
          <div
            key={`${props.tone}-${i}`}
            class="glow"
            style={{ left: `${(left / 390) * 100}%`, top: `${top}px`, width: `${size}px`, height: `${size}px`, opacity: strength, '--glow': color }}
          />
        ))}
      </div>
      {url && <div class="grain" style={{ backgroundImage: `url(${url})` }} />}
    </div>
  );
}
