import { render } from 'preact';
import { App } from './app';
import './styles.css';

// Ask the browser to keep our data even when storage runs low.
// (Home Screen web apps on iOS are already exempt from Safari's 7-day storage cleanup.)
navigator.storage?.persist?.().catch(() => {});

render(<App />, document.getElementById('app')!);
