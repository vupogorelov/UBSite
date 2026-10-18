// @ts-check
// «Что нового» (the page and the bell's item: web/src/features/whatsnew/): the project's whatsnew.md —
// the changes in plain words, by date ("## 2026-10-18"), the newest first. Read on every request: an
// entry added shows at once.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../http.js';

const FILE = fileURLToPath(new URL('../../whatsnew.md', import.meta.url));

/** @type {import('../core.js').Feature} */
export default {
  name: 'whatsnew',
  setup(core) {
    core.router.on('GET', '/api/whatsnew', () => {
      try {
        return { markdown: readFileSync(FILE, 'utf8') };
      } catch {
        throw new HttpError(404, 'Файл whatsnew.md не найден');
      }
    });
  },
};
