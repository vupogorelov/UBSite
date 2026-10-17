// @ts-check
// The Laboratory's model engine: a process of its own (forked by ../engine-client.js, at a lower priority),
// so the model's work never holds the server up and its failure never brings it down. It turns texts into
// vectors of meaning: { id, model, kind: 'query' | 'passage', texts } in, { id, vectors: Float32Array, dims }
// out. The models asked for are held; they are downloaded once into LAB_MODELS (data/models).
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.LAB_MODELS ?? 'models';
const threads = Number(process.env.LAB_THREADS) || 2;

/** The models loaded, by name: all held (the Laboratory compares them; the process ends when idle). @type {Map<string, Promise<any>>} */
const held = new Map();

/** @param {string} name */
function model(name) {
  let run = held.get(name);
  if (!run) {
    run = pipeline('feature-extraction', name, {
      dtype: 'q8', // (8-bit: a quarter of the size, nearly the same vectors)
      session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
    });
    run.catch(() => held.delete(name)); // (a failed load is tried again next time)
    held.set(name, run);
  }
  return run;
}

// the server gone (stopped, restarted): so is this
process.on('disconnect', () => process.exit(0));

process.on('message', async (/** @type {any} */ m) => {
  try {
    const run = await model(m.model);
    // the e5 models read a question and a text each with its own mark
    const texts = m.texts.map((/** @type {string} */ t) => (m.prefix ? `${m.kind}: ${t}` : t));
    // (how the text's pieces make one vector: their mean — e5; the first, the text's own mark — bge)
    const out = await run(texts, { pooling: m.pooling ?? 'mean', normalize: true });
    process.send?.({ id: m.id, vectors: out.data, dims: out.dims[1] });
  } catch (err) {
    process.send?.({ id: m.id, error: String(/** @type {Error} */ (err)?.message ?? err) });
  }
});
