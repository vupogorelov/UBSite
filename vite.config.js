import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  // Each build gets an id: the service worker is registered as sw.js?v=<id>, so a new build
  // installs a fresh worker that drops the old caches.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  server: {
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.UB_PORT ?? 4300}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
