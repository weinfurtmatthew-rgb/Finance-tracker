import { render } from 'preact';
import { App } from './app';
import { initAi } from './ai/client';
import './styles.css';

// Ask the browser to keep our data even when storage runs low.
// (Home Screen web apps on iOS are already exempt from Safari's 7-day storage cleanup.)
navigator.storage?.persist?.().catch(() => {});

render(<App />, document.getElementById('app')!);

// Finds out whether the AI models are published, and reloads them from the cache if AI is turned on.
void initAi();
