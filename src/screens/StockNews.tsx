/**
 * Settings → Stock News: headlines about the companies you hold, in the morning summary, from Alpha
 * Vantage with a free key of your own; and company announcements from Twelve Data with the price key.
 */
import { useState } from 'preact/hooks';
import { deleteMeta, setMeta } from '../db';
import { useMeta } from '../hooks';
import { useNav } from '../nav';
import { newsStoppedToday } from '../newsSync';
import { ANNOUNCEMENTS, NEWS_KEY, NEWS_TICKERS, type NewsErrorKind } from '../lib/news';
import { AV_SIGN_UP_URL } from '../lib/alphaVantage';
import { TWELVE_DATA_KEY } from '../lib/twelveData';
import { todayISO } from '../lib/dates';
import { ActionSheet, Field, Row, Section, Sheet, Toggle } from '../components/ui';

/** What stopped headlines, in a line. */
export const NEWS_PROBLEMS: Record<NewsErrorKind, string> = {
  key: 'Alpha Vantage didn’t accept the key. Check it in Settings → Stock News.',
  limit: 'Alpha Vantage’s free requests for today are used up. Headlines come back tomorrow.',
  plan: 'Alpha Vantage couldn’t send headlines.',
  network: 'Couldn’t reach Alpha Vantage. Headlines come back when you’re online.',
  other: 'Alpha Vantage couldn’t send headlines.',
};

/** The Settings row. */
export function StockNewsRow() {
  const nav = useNav();
  const key = useMeta<string>(NEWS_KEY);
  const stopped = key ? newsStoppedToday(todayISO()) : undefined;
  return (
    <Section
      title="Stock News"
      footer="Headlines about the companies you hold, in the morning summary, from Alpha Vantage with a free key of your own. Only ticker symbols are sent."
    >
      <Row
        title="Alpha Vantage"
        subtitle={key ? (stopped ? NEWS_PROBLEMS[stopped] : 'Headlines each morning') : 'Off'}
        detail={key ? 'On' : undefined}
        onClick={() => nav.present((close) => <StockNewsSheet onClose={close} />)}
      />
    </Section>
  );
}

export function StockNewsSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const key = useMeta<string>(NEWS_KEY);
  const priceKey = useMeta<string>(TWELVE_DATA_KEY);
  const announcements = useMeta<boolean>(ANNOUNCEMENTS) !== false;
  const [text, setText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const typed = text.trim();
  const stopped = key ? newsStoppedToday(todayISO()) : undefined;

  const save = async () => {
    if (!typed) return;
    await setMeta(NEWS_KEY, typed);
    setText('');
    nav.toast('Stock news on');
  };
  const remove = async () => {
    await deleteMeta(NEWS_KEY);
    setConfirmRemove(false);
    nav.toast('Stock news off');
  };

  return (
    <Sheet title="Stock News" onClose={props.onClose} onSave={key ? undefined : save} saveDisabled={!typed}>
      <div class="prose">
        <p class="prose-lead">Headlines about the companies you hold come from Alpha Vantage, free with a key of your own.</p>
        <p>
          Each morning, the summary asks Alpha Vantage for the last week’s news about your {NEWS_TICKERS} biggest stock holdings, by ticker symbol (like AAPL).
          Your amounts, shares and accounts never leave this phone, and the key stays on it too (it isn’t in backups). Headlines open the article on its own
          website.
        </p>
      </div>
      {key ? (
        <>
          <Section footer="The free plan allows 25 requests a day: 1 a company each morning.">
            <Row title="Key" detail={`•••• ${key.slice(-4)}`} chevron={false} />
            {stopped && <div class="row row-note">{NEWS_PROBLEMS[stopped]}</div>}
          </Section>
          <Section>
            <Row title="Remove Key" danger chevron={false} onClick={() => setConfirmRemove(true)} />
          </Section>
        </>
      ) : (
        <>
          <Section title="Get a free key">
            <a class="row link-row" href={AV_SIGN_UP_URL} target="_blank" rel="noopener noreferrer">
              <span class="row-main">
                <span class="row-title">1. Claim a key at alphavantage.co</span>
                <span class="row-subtitle">Free, no card needed</span>
              </span>
              <span class="chevron" aria-hidden="true">
                ›
              </span>
            </a>
            <Row title="2. Copy the key it shows you" chevron={false} />
            <Row title="3. Paste it below and tap Save" chevron={false} />
          </Section>
          <Section footer="Saving doesn’t use a request: if Alpha Vantage doesn’t take the key, the morning summary says so.">
            <Field label="API key">
              <input
                value={text}
                placeholder="Paste your key"
                autoComplete="off"
                autoCapitalize="off"
                spellcheck={false}
                onInput={(e) => setText((e.target as HTMLInputElement).value)}
              />
            </Field>
          </Section>
        </>
      )}
      {priceKey && (
        <Section footer="Press releases from the companies you hold, from Twelve Data with your price key: 1 request a company each morning.">
          <Toggle label="Company Announcements" checked={announcements} onChange={(on) => void setMeta(ANNOUNCEMENTS, on)} />
        </Section>
      )}
      {confirmRemove && (
        <ActionSheet
          message="Turn stock news off? The summary stops showing headlines."
          actions={[{ label: 'Remove Key', destructive: true, onClick: remove }]}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Sheet>
  );
}
