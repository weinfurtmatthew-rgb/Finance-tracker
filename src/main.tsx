import { render } from 'preact';
import { App } from './app';
import { DataProvider } from './store';
import { initAi } from './ai/client';
import './styles.css';
import { applySavedAccent } from './lib/appearance';

// Ask the browser to keep our data even when storage runs low.
// (Home Screen web apps on iOS are already exempt from Safari's 7-day storage cleanup.)
navigator.storage?.persist?.().catch(() => {});

// The accent color from last time, so the first frame isn't the wrong color.
applySavedAccent();

// One shared copy of the data for every screen (see store.tsx).
render(
  <DataProvider>
    <App />
  </DataProvider>,
  document.getElementById('app')!,
);

// Finds out whether the AI models are published, and reloads them from the cache if AI is turned on.
void initAi();
