// @ts-check
// Development: API server (restarts on change) + Vite dev server with /api proxy.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const procs = [
  spawn(process.execPath, ['--watch-path=server', '--watch-path=shared', '--disable-warning=ExperimentalWarning', 'server/main.js'], { cwd, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd, stdio: 'inherit' }),
];
for (const p of procs) {
  p.on('exit', (code) => {
    for (const other of procs) if (other !== p) other.kill();
    process.exit(code ?? 0);
  });
}
