// @ts-check
// The server's side of the model engine (engine/embed.js): the process is started when asked for vectors,
// at a lower priority, and stopped after ten minutes without work — the model holds no memory meanwhile.
// It dying (or never starting: no engine installed) fails the requests, never the server.
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority, constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./engine/embed.js', import.meta.url));
const INSTALLED = fileURLToPath(new URL('./engine/node_modules/@huggingface/transformers', import.meta.url));
const IDLE = 10 * 60_000;

/**
 * A model for the engine: its name; which of its files (`dtype`, `file`; `external` — weights in a file
 * beside); how the pieces of a text make one vector (engine/embed.js).
 * @typedef {{ name: string, dtype?: string, file?: string, external?: boolean, pooling: 'mean' | 'cls' | 'last_token' | 'sentence' }} Spec
 */

/** @param {string} models where the models are kept (data/models) */
export function createEngine(models) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let seq = 0;
  /** @type {Map<number, { resolve: (v: { vectors: Float32Array, dims: number }) => void, reject: (e: Error) => void }>} */
  const waiting = new Map();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let idle;

  function start() {
    if (child) return child;
    const c = fork(SCRIPT, {
      serialization: 'advanced', // (the vectors pass as they are, not as text)
      env: { ...process.env, LAB_MODELS: models, LAB_THREADS: '8' },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    try {
      if (c.pid) setPriority(c.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    c.on('message', (/** @type {any} */ m) => {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w?.reject(new Error(m.error));
      else w?.resolve({ vectors: m.vectors, dims: m.dims });
    });
    c.on('exit', () => {
      if (child === c) child = null;
      for (const w of waiting.values()) w.reject(new Error('Модель остановилась'));
      waiting.clear();
    });
    child = c;
    return c;
  }

  return {
    /** Whether the engine is installed (engine/node_modules). */
    installed: () => existsSync(INSTALLED),
    /** Whether its process runs now (a model in memory). */
    running: () => !!child,
    /**
     * Vectors of texts, marked as the model wants (n × dims, one after another; each of length 1).
     * @param {Spec} spec @param {string[]} texts
     * @returns {Promise<{ vectors: Float32Array, dims: number }>}
     */
    embed(spec, texts) {
      clearTimeout(idle);
      idle = setTimeout(() => child?.kill(), IDLE);
      idle.unref();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        start().send({ id, spec, texts });
      });
    },
    stop() {
      clearTimeout(idle);
      child?.kill();
    },
  };
}
