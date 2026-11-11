import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { readPending, savePending } from './lib/aiAccess';
import { captureOAuthRedirect } from './state/router';
import { StoreProvider } from './state/store';
import { SyncProvider } from './state/sync';

captureOAuthRedirect((id) => savePending(localStorage, id), () => readPending(localStorage));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <SyncProvider>
          <App />
        </SyncProvider>
      </StoreProvider>
    </ErrorBoundary>
  </StrictMode>,
);
