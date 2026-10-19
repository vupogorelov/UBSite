// @ts-check
// The Laboratory's model engine: a process of its own (forked by ../engine-client.js, at a lower priority),
// so the model's work never holds the server up and its failure never brings it down. It turns texts into
// vectors of meaning: { id, spec, texts } in (the texts already marked as the model wants), { id, vectors:
// Float32Array, dims } out. The models asked for are held; they are downloaded once into LAB_MODELS.
//
// A model's spec (../store.js MODELS): its name; `dtype` and `file` — which of its files (8-bit mostly);
// `external` — its weights in a file beside (.onnx_data); `pooling` — how the pieces of a text make one
// vector: their mean (e5), the first (Granite), the last (Qwen), or the model's own sentence output (Gemma).
import { pipeline, AutoModel, AutoTokenizer, env } from '@huggingface/transformers';

env.cacheDir = process.env.LAB_MODELS ?? 'models';
const threads = Number(process.env.LAB_THREADS) || 2;
const session_options = { intraOpNumThreads: threads, interOpNumThreads: 1 };

/** @typedef {{ name: string, dtype?: string, file?: string, external?: boolean, pooling: 'mean' | 'cls' | 'last_token' | 'sentence', device?: 'cpu' | 'dml' }} Spec */

/** The models loaded, by name: all held (the Laboratory compares them; the process ends when idle). @type {Map<string, Promise<(texts: string[]) => Promise<{ vectors: Float32Array, dims: number }>>>} */
const held = new Map();

/** @param {Spec} spec */
async function load(spec) {
  /** @type {any} */
  const options = {
    dtype: spec.dtype ?? 'q8', // (8-bit: a quarter of the size, nearly the same vectors)
    session_options,
    // the video card (DirectML): full precision only — its vectors are the processor's; the 8-bit ones differ
    ...(spec.device === 'dml' ? { device: 'dml' } : {}),
    ...(spec.file ? { model_file_name: spec.file } : {}),
    ...(spec.external ? { use_external_data_format: true } : {}),
  };
  if (spec.pooling === 'sentence') {
    // the model makes the sentence's vector itself (its pooling and projection inside)
    const tokenizer = await AutoTokenizer.from_pretrained(spec.name);
    const model = await AutoModel.from_pretrained(spec.name, options);
    return async (/** @type {string[]} */ texts) => {
      const out = await model(tokenizer(texts, { padding: true, truncation: true }));
      const e = out.sentence_embedding;
      const dims = e.dims[1];
      const vectors = Float32Array.from(e.data);
      for (let i = 0; i < texts.length; i++) {
        let len = 0;
        for (let k = 0; k < dims; k++) len += vectors[i * dims + k] ** 2;
        len = Math.sqrt(len) || 1;
        for (let k = 0; k < dims; k++) vectors[i * dims + k] /= len;
      }
      return { vectors, dims };
    };
  }
  const run = await pipeline('feature-extraction', spec.name, options);
  const pooling = /** @type {'mean' | 'cls' | 'last_token'} */ (spec.pooling);
  return async (/** @type {string[]} */ texts) => {
    const out = await run(texts, { pooling, normalize: true });
    return { vectors: /** @type {Float32Array} */ (out.data), dims: out.dims[1] };
  };
}

/** @param {Spec} spec */
function model(spec) {
  let run = held.get(spec.name);
  if (!run) {
    run = load(spec);
    run.catch(() => held.delete(spec.name)); // (a failed load is tried again next time)
    held.set(spec.name, run);
  }
  return run;
}

// the server gone (stopped, restarted): so is this
process.on('disconnect', () => process.exit(0));

process.on('message', async (/** @type {any} */ m) => {
  try {
    const { vectors, dims } = await (await model(m.spec))(m.texts);
    process.send?.({ id: m.id, vectors, dims });
  } catch (err) {
    process.send?.({ id: m.id, error: String(/** @type {Error} */ (err)?.message ?? err) });
  }
});
