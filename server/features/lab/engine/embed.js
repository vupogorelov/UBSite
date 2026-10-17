// @ts-check
// The Laboratory's model engine: a process of its own (forked by ../engine-client.js, at a lower priority),
// so the model's work never holds the server up and its failure never brings it down. It turns texts into
// vectors of meaning: { id, model, kind: 'query' | 'passage', texts } in, { id, vectors: Float32Array, dims }
// out. One model is held at a time; the models are downloaded once into LAB_MODELS (data/models).
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.LAB_MODELS ?? 'models';
const threads = Number(process.env.LAB_THREADS) || 2;

/** @type {{ name: string, run: any } | null} */
let held = null;

/** @param {string} name */
async function model(name) {
  if (held?.name === name) return held.run;
  if (held) await held.run.dispose?.();
  held = null;
  const run = await pipeline('feature-extraction', name, {
    dtype: 'q8', // (8-bit: a quarter of the size, nearly the same vectors)
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  held = { name, run };
  return run;
}

// the server gone (stopped, restarted): so is this
process.on('disconnect', () => process.exit(0));

process.on('message', async (/** @type {any} */ m) => {
  try {
    const run = await model(m.model);
    // the e5 models read a question and a text each with its own mark
    const texts = m.texts.map((/** @type {string} */ t) => (m.prefix ? `${m.kind}: ${t}` : t));
    const out = await run(texts, { pooling: 'mean', normalize: true });
    process.send?.({ id: m.id, vectors: out.data, dims: out.dims[1] });
  } catch (err) {
    process.send?.({ id: m.id, error: String(/** @type {Error} */ (err)?.message ?? err) });
  }
});
