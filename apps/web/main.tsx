import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { initializeAppConfigFromEnv } from './lib/config';
import runtimeEnv from './lib/env';

const hasWindow = typeof window !== 'undefined';

if (import.meta.env.DEV) {
  console.log('[bootstrap] captured env', { keys: Object.keys(runtimeEnv).length });
}

if (hasWindow) {
  (window as any).__VITE_ENV__ = runtimeEnv;
}

initializeAppConfigFromEnv(runtimeEnv);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
