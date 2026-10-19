// @ts-check
// The server's side of the model engine (engine/embed.js): a process per model (and device) — so several
// models can work out their vectors at once, each with its own threads — started when asked for vectors,
// at a lower priority, and stopped after ten minutes without work: the model holds no memory meanwhile.
// One dying (or never starting: no engine installed) fails its requests, never the server.
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority, constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./engine/embed.js', import.meta.url));
const INSTALLED = fileURLToPath(new URL('./engine/node_modules/@huggingface/transformers', import.meta.url));
const IDLE = 10 * 60_000;

/**
 * A model for the engine: its name; which of its files (`dtype`, `file`; `external` — weights in a file
 * beside); how the pieces of a text make one vector (engine/embed.js); `device` — 'dml': on the video card
 * (DirectML), else the processor.
 * @typedef {{ name: string, dtype?: string, file?: string, external?: boolean, pooling: 'mean' | 'cls' | 'last_token' | 'sentence', device?: 'cpu' | 'dml' }} Spec
 */

/** @typedef {{ child: import('node:child_process').ChildProcess, threads: number, waiting: Map<number, { resolve: (v: { vectors: Float32Array, dims: number }) => void, reject: (e: Error) => void }>, idle?: ReturnType<typeof setTimeout> }} Proc */

/** @param {string} models where the models are kept (data/models) */
export function createEngine(models) {
  /** The processes, by model and device. @type {Map<string, Proc>} */
  const procs = new Map();
  let seq = 0;

  /** @param {string} key @param {number} threads */
  function start(key, threads) {
    const c = fork(SCRIPT, {
      serialization: 'advanced', // (the vectors pass as they are, not as text)
      env: { ...process.env, LAB_MODELS: models, LAB_THREADS: String(threads) },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    try {
      if (c.pid) setPriority(c.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    /** @type {Proc} */
    const p = { child: c, threads, waiting: new Map() };
    c.on('message', (/** @type {any} */ m) => {
      const w = p.waiting.get(m.id);
      p.waiting.delete(m.id);
      if (m.error) w?.reject(new Error(m.error));
      else w?.resolve({ vectors: m.vectors, dims: m.dims });
    });
    c.on('exit', () => {
      if (procs.get(key) === p) procs.delete(key);
      clearTimeout(p.idle);
      for (const w of p.waiting.values()) w.reject(new Error('Модель остановилась'));
      p.waiting.clear();
    });
    procs.set(key, p);
    return p;
  }

  return {
    /** Whether the engine is installed (engine/node_modules). */
    installed: () => existsSync(INSTALLED),
    /** Whether a process runs now (a model in memory). */
    running: () => procs.size > 0,
    /**
     * Vectors of texts, marked as the model wants (n × dims, one after another; each of length 1).
     * `threads`: the processor threads of the model's process when it starts; `exact` — another number
     * restarts a running one (when it has nothing in hand; the model is loaded again), else it serves as it is
     * (a question).
     * @param {Spec} spec @param {string[]} texts @param {{ threads: number, exact?: boolean }} [opts]
     * @returns {Promise<{ vectors: Float32Array, dims: number }>}
     */
    embed(spec, texts, { threads, exact } = { threads: 8 }) {
      const key = `${spec.name} ${spec.device ?? 'cpu'}`;
      let p = procs.get(key);
      if (p && exact && p.threads !== threads && !p.waiting.size) {
        procs.delete(key);
        p.child.kill();
        p = undefined;
      }
      p ??= start(key, threads);
      const proc = p;
      clearTimeout(proc.idle);
      proc.idle = setTimeout(() => proc.child.kill(), IDLE);
      proc.idle.unref();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        proc.waiting.set(id, { resolve, reject });
        proc.child.send({ id, spec, texts });
      });
    },
    stop() {
      for (const p of procs.values()) {
        clearTimeout(p.idle);
        p.child.kill();
      }
    },
  };
}
