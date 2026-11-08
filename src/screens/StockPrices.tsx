/** Settings → Stock Prices: your own free Twelve Data key, and how updating prices is going. */
import { useState } from 'preact/hooks';
import { deleteMeta, setMeta } from '../db';
import { useMeta } from '../hooks';
import { useNav } from '../nav';
import { useTrades } from '../portfolioModel';
import { syncPrices, testKey, usePriceSync } from '../priceSync';
import { explainPriceError, PRICE_PROBLEMS, PriceError, TWELVE_DATA_KEY } from '../lib/twelveData';
import { ActionSheet, Field, Row, Section, Sheet } from '../components/ui';

export const SIGN_UP_URL = 'https://twelvedata.com/register';

const time = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The Settings row. */
export function StockPricesRow() {
  const nav = useNav();
  const key = useMeta<string>(TWELVE_DATA_KEY);
  const sync = usePriceSync();
  return (
    <Section
      title="Stock Prices"
      footer="Prices for the stocks, ETFs and funds in your investment accounts, from Twelve Data with a free key of your own. Only ticker symbols are sent."
    >
      <Row
        title="Twelve Data"
        subtitle={key ? (sync.error ? PRICE_PROBLEMS[sync.error.kind] : sync.running ? 'Updating prices…' : `${sync.used} of 800 requests used today`) : 'Off'}
        detail={key ? 'On' : undefined}
        onClick={() => nav.present((close) => <StockPricesSheet onClose={close} />)}
      />
    </Section>
  );
}

export function StockPricesSheet(props: { onClose: () => void }) {
  const nav = useNav();
  const key = useMeta<string>(TWELVE_DATA_KEY);
  const sync = usePriceSync();
  const trades = useTrades();
  const [text, setText] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const typed = text.trim();

  const save = async () => {
    if (!typed || checking) return;
    setChecking(true);
    setProblem(undefined);
    try {
      await testKey(typed);
      await setMeta(TWELVE_DATA_KEY, typed);
      setText('');
      nav.toast('Stock prices on');
      void syncPrices({ force: true });
    } catch (e) {
      const kind = e instanceof PriceError ? e.kind : undefined;
      setProblem(
        kind === 'key'
          ? 'Twelve Data didn’t accept this key. Check that it’s copied in full from your Twelve Data dashboard.'
          : kind === 'network'
            ? 'Couldn’t reach Twelve Data. Check your connection and try again.'
            : explainPriceError(e),
      );
    } finally {
      setChecking(false);
    }
  };
  const remove = async () => {
    await deleteMeta(TWELVE_DATA_KEY);
    setConfirmRemove(false);
    nav.toast('Stock prices off');
  };

  return (
    <Sheet
      title="Stock Prices"
      onClose={props.onClose}
      onSave={key ? undefined : save}
      saveLabel={checking ? 'Checking…' : 'Save'}
      saveDisabled={!typed || checking}
    >
      <div class="prose">
        <p class="prose-lead">Prices for the stocks, ETFs and funds in your investment accounts come from Twelve Data, free with a key of your own.</p>
        <p>
          The app asks Twelve Data only for prices, by ticker symbol (like VTI). Your amounts, shares and accounts never leave this phone, and the key stays on
          it too (it isn’t in backups).
        </p>
      </div>
      {key ? (
        <>
          <Section footer="The free plan allows 800 requests a day and 8 a minute. A holding’s first prices take 3, and each update after that 1, about every 4 hours while the market is open.">
            <Row title="Key" detail={`•••• ${key.slice(-4)}`} chevron={false} />
            <Row title="Requests Today" detail={`${sync.used} of 800`} chevron={false} />
            <Row title="Last Updated" detail={sync.running ? 'Updating…' : sync.lastRun ? time(sync.lastRun) : '—'} chevron={false} />
            {sync.error && <div class="row row-note">{explainPriceError(new PriceError(sync.error.kind, sync.error.message))}</div>}
            <Row
              title="Update Prices Now"
              subtitle={trades.length ? undefined : 'Add holdings to an investment account first'}
              onClick={() => void syncPrices({ force: true })}
            />
          </Section>
          <Section>
            <Row title="Remove Key" danger chevron={false} onClick={() => setConfirmRemove(true)} />
          </Section>
        </>
      ) : (
        <>
          <Section title="Get a free key">
            <a class="row link-row" href={SIGN_UP_URL} target="_blank" rel="noopener noreferrer">
              <span class="row-main">
                <span class="row-title">1. Sign up at twelvedata.com</span>
                <span class="row-subtitle">Free: the Basic plan, no card needed</span>
              </span>
              <span class="chevron" aria-hidden="true">
                ›
              </span>
            </a>
            <Row title="2. Copy your API key" subtitle="On your Twelve Data dashboard, under API Keys" chevron={false} />
            <Row title="3. Paste it below and tap Save" chevron={false} />
          </Section>
          <Section footer={problem ?? 'Saving checks the key with Twelve Data (that’s 1 request).'}>
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
      {confirmRemove && (
        <ActionSheet
          message="Turn stock prices off? Holdings keep the prices already downloaded, but stop updating."
          actions={[{ label: 'Remove Key', destructive: true, onClick: remove }]}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Sheet>
  );
}
