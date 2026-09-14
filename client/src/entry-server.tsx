import { renderToString } from 'react-dom/server';
import { App } from './App.tsx';
import type { InitialData } from './types.ts';

export async function render(url: string, initialData: InitialData): Promise<{ html: string }> {
  const html = renderToString(<App url={url} initialData={initialData} />);
  return { html };
}
