import type { InitialData } from './types.ts';
import { Dashboard } from './components/Dashboard.tsx';
import { SavePopup } from './components/SavePopup.tsx';
import { AuthPage } from './components/AuthPage.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';

export function App({ url, initialData }: { url: string; initialData: InitialData }) {
  if (initialData.kind === 'auth') {
    return <AuthPage />;
  }
  if (initialData.kind === 'save') {
    return <SavePopup initialData={initialData} />;
  }
  if (initialData.kind === 'settings') {
    return <SettingsPage initialData={initialData} />;
  }
  return <Dashboard url={url} initialData={initialData} />;
}
