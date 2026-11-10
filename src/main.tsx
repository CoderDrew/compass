import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { StoreProvider } from './state/store';
import { SyncProvider } from './state/sync';

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
