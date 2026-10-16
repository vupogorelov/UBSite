import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

// Each build gets an id: the service worker is registered as sw.js?v=<id>, so a new build
// installs a fresh worker that drops the old caches; /version.json carries it too, so a running app
// learns that a newer build is out (the bell offers a restart).
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  root: 'web',
  plugins: [
    svelte(),
    {
      // shared/api-policy.js for the service worker, which takes plain scripts (importScripts):
      // the same file, its exports made the worker's own (self.apiPolicy)
      name: 'api-policy',
      apply: 'build',
      generateBundle() {
        const src = readFileSync(new URL('./shared/api-policy.js', import.meta.url), 'utf8');
        if (/^\s*import\s/m.test(src)) this.error('shared/api-policy.js must import nothing: the service worker takes it as a plain script');
        const body = src.replace(/^export \{ readPolicy, writePolicy, API_RULES \};\s*$/m, '');
        if (body === src) this.error('shared/api-policy.js: its export line was not found');
        this.emitFile({ type: 'asset', fileName: 'api-policy.js', source: `(() => {\n${body}\nself.apiPolicy = { readPolicy, writePolicy };\n})();\n` });
      },
    },
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
