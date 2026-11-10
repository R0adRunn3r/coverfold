import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import './ui/styles.css';
import { App } from './ui/App';
import { initTheme } from './ui/theme';

initTheme();

// Offline use (installed app): the service worker exists only in the built app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`); });
}

// Development aid: the local test bench (src/dev, not in the repository), loaded on demand from the console.
if (import.meta.env.DEV) {
  const bench = import.meta.glob('./dev/testbench.ts')['./dev/testbench.ts'];
  if (bench) (window as unknown as { __testbench: unknown }).__testbench = bench;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
