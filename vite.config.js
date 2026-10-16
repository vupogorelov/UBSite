import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Each build gets an id: the service worker is registered as sw.js?v=<id>, so a new build
// installs a fresh worker that drops the old caches; /version.json carries it too, so a running app
// learns that a newer build is out (the bell offers a restart).
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  root: 'web',
  plugins: [
    svelte(),
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID, at: new Date().toISOString() }) });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.UB_PORT ?? 4300}` },
  },
  // manifest: every file of the build listed (.vite/manifest.json) — the service worker keeps them all,
  // the parts loaded later too (public/sw.js)
  build: { outDir: 'dist', emptyOutDir: true, manifest: true },
});
