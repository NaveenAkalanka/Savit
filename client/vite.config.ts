import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    outDir: isSsrBuild ? 'dist/server' : 'dist/client',
    emptyOutDir: true,
  },
  // Bundle every dependency straight into entry-server.js instead of Vite's
  // SSR default (leave node_modules imports external, resolved at runtime).
  // The Docker/Render runtime always has a full node_modules, so this never
  // mattered there — but a self-contained bundle is what a serverless
  // function needs, since it only ships what's explicitly included.
  ssr: isSsrBuild ? { noExternal: true } : undefined,
}));
