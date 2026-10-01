import type { JSX } from 'preact';

/**
 * The app's line icons: drawn on a 24 × 24 grid with 2px round strokes, so they sit together with the
 * system font. Built-in categories use them on a colored chip; emoji stay for categories you make.
 */
const SHAPES = {
  // Navigation & actions
  today: () => (
    <>
      <path d="M4.6 16.5a8 8 0 1 1 14.8 0" />
      <path d="M12 13.5l3.6-4" />
      <path d="M12 13.5h.01" />
    </>
  ),
  list: () => <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  grid: () => (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  search: () => (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  gear: () => (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  person: () => (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  minus: () => <path d="M6 12h12" />,
  close: () => <path d="M6 6l12 12M18 6L6 18" />,
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
  chevronLeft: () => <path d="M14.5 5.5L8 12l6.5 6.5" />,
  chevronRight: () => <path d="M9.5 5.5L16 12l-6.5 6.5" />,
  up: () => <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  down: () => <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  sliders: () => (
    <>
      <path d="M4 7h9M18 7h2M4 17h3M11 17h9" />
      <circle cx="15.5" cy="7" r="2.2" />
      <circle cx="8.5" cy="17" r="2.2" />
    </>
  ),
  pin: () => <path d="M9 3.5h6l-1 5 3.2 3.2H6.8L10 8.5l-1-5zM12 11.7V21" />,
  info: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: () => <path d="M12 4l9 16H3l9-16zM12 10v4M12 17h.01" />,
  help: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17h.01" />
    </>
  ),
  spark: () => <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5zM19 16v4M17 18h4" />,
  calc: () => (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.6" />
      <path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01" />
    </>
  ),
  fileIn: () => <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9zM13.5 3.5V9H19M12 11.5v6M9.4 15l2.6 2.6 2.6-2.6" />,
  upload: () => <path d="M12 15V4M8 8l4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  lock: () => (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  hourglass: () => <path d="M7 3.5h10M7 20.5h10M8 3.5v2.3a4 4 0 0 0 1.6 3.2L12 11l2.4-2a4 4 0 0 0 1.6-3.2V3.5M8 20.5v-2.3a4 4 0 0 1 1.6-3.2L12 13l2.4 2a4 4 0 0 1 1.6 3.2v2.3" />,
  calendar: () => (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.6" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),

  // Money
  income: () => <path d="M12 3.5V14M8 10.5l4 4 4-4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />,
  trend: () => <path d="M3 17l6-6 4 4 7.5-7.5M15 7.5h5.5V13" />,
  bars: () => <path d="M4 20.5h16M7 17v-5M12 17V7M17 17v-7" />,
  bank: () => <path d="M3 9.2L12 4l9 5.2M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3 20.5h18" />,
  vault: () => (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 8.6V7M12 17v-1.6M15.4 12H17M7 12h1.6" />
    </>
  ),
  card: () => (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.6" />
      <path d="M2.5 10h19M6.5 15h4" />
    </>
  ),
  receipt: () => <path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5" />,
  swap: () => <path d="M7 4L4 7l3 3M4 7h13M17 20l3-3-3-3M20 17H7" />,
  repeat: () => <path d="M17 2.8l3 3-3 3M20 5.8H8.5A4.5 4.5 0 0 0 4 10.3v.7M7 21.2l-3-3 3-3M4 18.2h11.5a4.5 4.5 0 0 0 4.5-4.5V13" />,
  target: () => (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.8" />
      <path d="M12 12h.01" />
    </>
  ),
  flag: () => <path d="M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11" />,
  shield: () => <path d="M12 3.2l7 2.9v5.6c0 4.2-3 7.7-7 9.3-4-1.6-7-5.1-7-9.3V6.1l7-2.9zM8.8 12l2.2 2.2 4.2-4.4" />,
  users: () => <path d="M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.7a3.5 3.5 0 0 1 0 6.6M18.2 14.2a6.5 6.5 0 0 1 3.3 5.8" />,
  tag: () => <path d="M3.5 4.5v7l9 9 8-8-9-9h-7a1 1 0 0 0-1 1zM8 9h.01" />,
  heart: () => <path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />,
  dice: () => (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" />
    </>
  ),
  sun: () => (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </>
  ),
  play: () => (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M10.5 9.5v5l4-2.5-4-2.5z" />
    </>
  ),

  // Spending
  cart: () => <path d="M3 4h2.4l2.3 10.3a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L21 8.2H6.3M10 19.6h.01M17 19.6h.01" />,
  dining: () => <path d="M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17.5 21V3c-1.9 1.6-3.2 4.4-3.2 7.5V13h3.2" />,
  coffee: () => <path d="M5 9.5h11V14a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.5zM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v3M11.5 3.5v3" />,
  wine: () => <path d="M7.5 3.5h9v4a4.5 4.5 0 0 1-9 0v-4zM7.5 7.5h9M12 12v8.5M8.5 20.5h7" />,
  fuel: () => <path d="M5.5 20.5V5.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v15M4 20.5h12M5.5 10.5h9M14.5 9h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8.5L19 6" />,
  car: () => <path d="M4.5 15.5V11l2-4.5a1.8 1.8 0 0 1 1.6-1h7.8a1.8 1.8 0 0 1 1.6 1l2 4.5v4.5M3.5 15.5h17V18a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1v-.5H7v.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1v-2.5zM4.5 11h15" />,
  key: () => (
    <>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="M10.4 12.6L20 3M17 6l2 2M14.5 8.5l1.8 1.8" />
    </>
  ),
  wrench: () => <path d="M13.4 13A5 5 0 0 0 20.1 6.5l-2.3 2.2-2.5-2.5 2.2-2.3A5 5 0 0 0 11 10.6l-7.2 7.2a1.7 1.7 0 0 0 2.4 2.4z" />,
  bag: () => <path d="M5 8h14l-1.1 12H6.1L5 8zM9 8V6.5a3 3 0 0 1 6 0V8" />,
  shirt: () => <path d="M9 3.5L4 5.8l-1.5 4.7 3.5 1.2v8.8h12v-8.8l3.5-1.2L20 5.8l-5-2.3a3 3 0 0 1-6 0z" />,
  phone: () => (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  plant: () => <path d="M7 14.5h10l-1.2 6H8.2zM12 14.5V10M12 10.5c0-3.5 2.2-6 6-6 0 3.5-2.2 6-6 6zM12 12c0-2.8-1.8-4.5-5-4.5 0 2.8 1.8 4.5 5 4.5z" />,
  bolt: () => <path d="M13 3L5 13.5h6.2L10.5 21l8-10.5h-6.2L13 3z" />,
  home: () => <path d="M3.5 11L12 4l8.5 7M6 9.4V20h12V9.4M10 20v-5h4v5" />,
  cross: () => <path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z" />,
  dumbbell: () => <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  plane: () => <path transform="rotate(45 12 12)" d="M12 2.8c.9 0 1.5.9 1.5 2.2v4l7 4.3v2.1l-7-2.2v4.3l2.2 1.6v1.7L12 20l-3.7.8v-1.7l2.2-1.6v-4.3l-7 2.2v-2.1l7-4.3V5c0-1.3.6-2.2 1.5-2.2z" />,
  scissors: () => (
    <>
      <circle cx="6.5" cy="6.5" r="2.8" />
      <circle cx="6.5" cy="17.5" r="2.8" />
      <path d="M8.8 8.2L20 17.5M8.8 15.8L20 6.5" />
    </>
  ),
  paw: () => (
    <>
      <circle cx="5.2" cy="10.4" r="1.6" />
      <circle cx="9" cy="5.6" r="1.6" />
      <circle cx="15" cy="5.6" r="1.6" />
      <circle cx="18.8" cy="10.4" r="1.6" />
      <path d="M12 11.5c-2.6 0-5 3.3-5 5.6 0 1.6 1.1 2.4 2.5 2.4.9 0 1.7-.5 2.5-.5s1.6.5 2.5.5c1.4 0 2.5-.8 2.5-2.4 0-2.3-2.4-5.6-5-5.6z" />
    </>
  ),
  balloon: () => <path d="M12 15.5c3 0 5.5-2.9 5.5-6.3A5.5 5.5 0 0 0 12 3.7a5.5 5.5 0 0 0-5.5 5.5c0 3.4 2.5 6.3 5.5 6.3zM12 15.5l-.9 1.6h1.8zM12 17.1c0 1.6-1.6 2-1.6 3.4" />,
  school: () => <path d="M2.5 9.5L12 5l9.5 4.5L12 14zM6.5 11.6V16c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.4M21.5 9.5V15" />,
  gift: () => (
    <>
      <rect x="3.5" y="8" width="17" height="4.5" rx="1" />
      <path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5M12 8v12.5M12 8H8.6a2.3 2.3 0 0 1 0-4.6C11 3.4 12 8 12 8zM12 8h3.4a2.3 2.3 0 0 0 0-4.6C13 3.4 12 8 12 8z" />
    </>
  ),
  box: () => <path d="M3.5 7.5L12 3.2l8.5 4.3v9L12 20.8l-8.5-4.3zM3.5 7.5l8.5 4.3 8.5-4.3M12 11.8v9" />,
} satisfies Record<string, () => JSX.Element>;

export type GlyphName = keyof typeof SHAPES;

export const isGlyph = (name: string): name is GlyphName => Object.hasOwn(SHAPES, name);

export function Glyph(props: { name: GlyphName; class?: string }) {
  return (
    <svg
      class={`glyph ${props.class ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {SHAPES[props.name]()}
    </svg>
  );
}

/** The colors of the category chips (each hue has a deep variant that white icons read well on). */
export type Hue = 'blue' | 'orange' | 'aqua' | 'yellow' | 'magenta' | 'green' | 'violet' | 'red' | 'gray';

/** A line icon in white on a colored, rounded-square chip. */
export function IconChip(props: { name: GlyphName; hue: Hue; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span class={`cat-icon icon-chip ${props.size ?? 'md'}`} style={{ background: `var(--deep-${props.hue})` }} aria-hidden="true">
      <Glyph name={props.name} />
    </span>
  );
}

/** Icons for the tab bar and toolbar buttons. */
export const Icons = {
  home: () => <Glyph name="today" />,
  activity: () => <Glyph name="list" />,
  recurring: () => <Glyph name="repeat" />,
  accounts: () => <Glyph name="trend" />,
  settings: () => <Glyph name="gear" />,
  plus: () => <Glyph name="plus" />,
  import: () => <Glyph name="fileIn" />,
  sparkle: () => <Glyph name="spark" />,
  calculator: () => <Glyph name="calc" />,
  search: () => <Glyph name="search" />,
};
