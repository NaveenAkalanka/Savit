import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.ts';

type RenderFn = (url: string, initialData: unknown) => Promise<{ html: string }>;

export interface SsrRenderer {
  renderPage(url: string, initialData: unknown): Promise<string>;
  attachMiddleware?(app: FastifyInstance): Promise<void>;
}

function injectHtml(template: string, appHtml: string, initialData: unknown): string {
  const serialized = JSON.stringify(initialData).replace(/</g, '\\u003c');
  const dataScript = `<script>window.__INITIAL_DATA__=${serialized}</script>`;
  return template
    .replace('<!--ssr-outlet-->', appHtml)
    .replace('<!--ssr-initial-data-->', dataScript);
}

export async function createSsrRenderer(config: Config): Promise<SsrRenderer> {
  if (config.staticDir) {
    // Production: staticDir is client/dist/client; the SSR bundle lives as a
    // sibling at client/dist/server/entry-server.js (built via `vite build --ssr`).
    const serverEntryPath = path.resolve(config.staticDir, '../server/entry-server.js');
    const mod = (await import(pathToFileURL(serverEntryPath).href)) as { render: RenderFn };
    const template = fs.readFileSync(path.join(config.staticDir, 'index.html'), 'utf-8');

    return {
      async renderPage(url, initialData) {
        const { html } = await mod.render(url, initialData);
        return injectHtml(template, html, initialData);
      },
    };
  }

  // Dev: transform + execute the SSR entry on every request via Vite, no build step.
  // Computed here (not at module scope) so bundlers that stub out import.meta
  // outside real ESM (e.g. a CJS Lambda bundle) don't choke on it — this
  // branch never runs in production anyway, where config.staticDir is set.
  const clientRoot = path.resolve(import.meta.dirname, '../../client');
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root: clientRoot,
    server: { middlewareMode: true },
    appType: 'custom',
  });

  return {
    async renderPage(url, initialData) {
      const rawTemplate = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf-8');
      const template = await vite.transformIndexHtml(url, rawTemplate);
      const mod = (await vite.ssrLoadModule('/src/entry-server.tsx')) as { render: RenderFn };
      const { html } = await mod.render(url, initialData);
      return injectHtml(template, html, initialData);
    },
    async attachMiddleware(app: FastifyInstance) {
      const middie = (await import('@fastify/middie')).default;
      await app.register(middie);
      app.use(vite.middlewares);
    },
  };
}
