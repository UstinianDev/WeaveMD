// ============================================
// WeaveMD — Renderer Entry Point
// ============================================

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import './styles/globals.css';
// Configure Monaco Editor to load from local package (not CDN)
import './utils/monacoSetup';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element not found. Ensure index.html has <div id="root">.');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
