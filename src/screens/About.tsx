import { useNav } from '../nav';
import { Row, Section, Sheet } from '../components/ui';
import { IconChip } from '../components/icons';
import { ImportFlow } from '../lazy';
import { Onboarding } from './Onboarding';

/** "0.1.0 (abc1234)": the version, and the build's commit when it came from GitHub. */
export const versionLabel = () => (__BUILD_COMMIT__ ? `${__APP_VERSION__} (${__BUILD_COMMIT__})` : __APP_VERSION__);

/** The privacy policy, in plain words. Everything here is true of how the app is built; keep it that way. */
export function PrivacySheet(props: { onClose: () => void }) {
  return (
    <Sheet title="Privacy" onClose={props.onClose} readable>
      <div class="prose">
        <p class="prose-lead">Your financial data never leaves this phone. There's no account, no server and no tracking.</p>

        <h3>What the app stores</h3>
        <p>
          The accounts, transactions, categories, budgets and settings you add are kept in this browser's private storage on your phone. Only this app,
          on this phone, can read them.
        </p>

        <h3>What it sends</h3>
        <p>
          Nothing about your money. The app has no server to send it to, and it's built so it can only talk to the website it's loaded from (a
          security rule that blocks every other address). It contacts that website only to:
        </p>
        <ul>
          <li>load the app itself, and its updates;</li>
          <li>download the on-device AI model, if you turn that on in Settings. The model then runs on your phone.</li>
        </ul>
        <p>
          The app is hosted on GitHub Pages. Like any website host, GitHub can see that your phone loaded the app (for example its IP address),
          but never anything you enter.
        </p>

        <h3>No tracking</h3>
        <p>No analytics, no ads, no cookies, and no third-party code that reports on what you do.</p>

        <h3>Bank files and backups</h3>
        <p>
          Files you import are read on the phone and aren't kept. Backups are files you save where you choose, like iCloud Drive; protect them
          with a password to make them unreadable without it.
        </p>

        <h3>Deleting your data</h3>
        <p>
          Settings → Erase All Data deletes everything from this phone right away. Removing the app from your Home Screen does too. Backups you
          saved elsewhere stay until you delete them.
        </p>
      </div>
    </Sheet>
  );
}

/** About: the version, and the intro again. */
export function AboutSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const showIntro = () =>
    nav.present((close) => (
      <div class="onboarding-layer">
        <Onboarding
          onDone={(next) => {
            close();
            if (next === 'import') nav.present((c) => <ImportFlow onClose={c} />);
          }}
        />
      </div>
    ));
  return (
    <Sheet title="About" onClose={props.onClose}>
      <div class="about-head">
        <IconChip name="shield" hue="green" size="lg" />
        <h2>Finance Tracker</h2>
        <p class="muted">Private money tracking that stays on your phone.</p>
      </div>
      <Section>
        <Row title="Version" detail={versionLabel()} chevron={false} />
        <Row title="Built" detail={new Date(`${__BUILD_DATE__}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' })} chevron={false} />
      </Section>
      <Section>
        <Row title="Privacy" onClick={() => nav.present((close) => <PrivacySheet onClose={close} />)} />
        <Row title="Show the Intro Again" onClick={showIntro} />
      </Section>
    </Sheet>
  );
}
