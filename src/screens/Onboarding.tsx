import { useState } from 'preact/hooks';
import { Glyph, IconChip, type GlyphName, type Hue } from '../components/icons';

interface Page {
  glyph: GlyphName;
  hue: Exclude<Hue, 'gray'>;
  title: string;
  body: string;
  points: string[];
}

const PAGES: Page[] = [
  {
    glyph: 'shield',
    hue: 'green',
    title: 'Your money, on your phone',
    body: 'Track spending, bills and net worth without handing your bank login to anyone.',
    points: ['No account to sign up for', 'No bank passwords, ever', 'Nothing is uploaded: there is no server'],
  },
  {
    glyph: 'upload',
    hue: 'blue',
    title: 'Bring in your transactions',
    body: 'Download a file from your bank’s website and open it here. The app sorts it into categories and finds your bills.',
    points: ['CSV, QFX and OFX from any bank', 'Venmo, Cash App and Apple Cash statements', 'A Rocket Money export, to switch over'],
  },
  {
    glyph: 'lock',
    hue: 'violet',
    title: 'Keep it safe',
    body: 'Because your data lives only on this phone, you’re in charge of keeping a copy.',
    points: ['Back up to iCloud Drive, with a password if you like', 'Lock the app with a passcode', 'Add it to your Home Screen to keep your data from being cleared'],
  },
];

/** A short intro on first launch: what the app is, how data gets in, and keeping it safe. */
export function Onboarding(props: { onDone: (next: 'import' | 'explore') => void }) {
  const [index, setIndex] = useState(0);
  const page = PAGES[index];
  const last = index === PAGES.length - 1;
  return (
    <main class="onboarding" aria-labelledby="onboarding-title">
      <div class="onboarding-top">
        {!last && (
          <button type="button" class="link" onClick={() => props.onDone('explore')}>
            Skip
          </button>
        )}
      </div>
      <div class="onboarding-page" key={index}>
        <IconChip name={page.glyph} hue={page.hue} size="lg" />
        <h1 id="onboarding-title">{page.title}</h1>
        <p class="onboarding-body">{page.body}</p>
        <ul class="card onboarding-points">
          {page.points.map((p) => (
            <li>
              <Glyph name="check" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div class="onboarding-foot">
        <div class="onboarding-dots" role="img" aria-label={`Page ${index + 1} of ${PAGES.length}`}>
          {PAGES.map((_, i) => (
            <span class={i === index ? 'on' : ''} />
          ))}
        </div>
        {last ? (
          <div class="button-stack">
            <button type="button" class="button primary" onClick={() => props.onDone('import')}>
              Import a Bank File
            </button>
            <button type="button" class="button" onClick={() => props.onDone('explore')}>
              Look Around First
            </button>
          </div>
        ) : (
          <button type="button" class="button primary" onClick={() => setIndex(index + 1)}>
            Continue
          </button>
        )}
      </div>
    </main>
  );
}
