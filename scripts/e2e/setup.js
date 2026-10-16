// One-time: Chromium 114 (the engine of the Android WebView on the author's phone), kept outside the
// project (it is on a synced disk): lib.js BROWSERS. The current Chrome is the one installed on the computer.
//   cd scripts/e2e && npm install && npm run setup
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BROWSERS } from './lib.js';

const here = fileURLToPath(new URL('.', import.meta.url));
execFileSync(process.execPath, [`${here}node_modules/pw114/cli.js`, 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS },
});
