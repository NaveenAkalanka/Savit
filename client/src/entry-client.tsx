import { hydrateRoot } from 'react-dom/client';
import { App } from './App.tsx';

const initialData = window.__INITIAL_DATA__;
if (!initialData) {
  throw new Error('Missing window.__INITIAL_DATA__ — the SSR render did not inject it');
}

hydrateRoot(
  document.getElementById('root')!,
  <App url={window.location.pathname + window.location.search} initialData={initialData} />,
);
