// @ts-check
// The Laboratory's model engine: a process of its own (forked by ../engine-client.js, at a lower priority),
// so the model's work never holds the server up and its failure never brings it down. It turns texts into
// vectors of meaning: { id, spec, texts } in (the texts already marked as the model wants), { id, vectors:
// Float32Array, dims } out. The models asked for are held; they are downloaded once into LAB_MODELS.
// It also writes: { id, op: 'write', spec, messages, max } in — a small generative model's answer to a
// conversation, { id, text, tokens } out.
//
// A model's spec (../store.js MODELS): its name; `dtype` and `file` — which of its files (8-bit mostly);
// `external` — its weights in a file beside (.onnx_data); `pooling` — how the pieces of a text make one
// vector: their mean (e5), the first (Granite), the last (Qwen), or the model's own sentence output (Gemma).
import * as T from '@huggingface/transformers';
import { pipeline, AutoConfig, AutoModel, AutoTokenizer, env } from '@huggingface/transformers';

env.cacheDir = process.env.LAB_MODELS ?? 'models';
const threads = Number(process.env.LAB_THREADS) || 2;
const session_options = { intraOpNumThreads: threads, interOpNumThreads: 1 };

/** @typedef {{ name: string, dtype?: string, file?: string, external?: boolean, textOnly?: boolean, pooling: 'mean' | 'cls' | 'last_token' | 'sentence', device?: 'cpu' | 'dml' }} Spec */

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
    if (spec.textOnly) {
      // a model of pictures and sound too (EmbeddingGemma 2): its text part alone
      const config = /** @type {any} */ (await AutoConfig.from_pretrained(spec.name));
      config.vision_config = config.audio_config = null;
      options.config = config;
    }
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

/**
 * A model that writes (a small generative one, «Я и Книга»'s answers): its name, its class (of text and
 * pictures — the text alone is given), which files (4-bit). On the processor: on DirectML these write nonsense.
 * @typedef {{ name: string, cls: string, dtype?: string }} Writer
 */
/** @type {Map<string, Promise<(messages: { role: string, content: string }[], max: number) => Promise<{ text: string, tokens: number }>>>} */
const writers = new Map();

/** @param {Writer} spec */
async function loadWriter(spec) {
  const tokenizer = await AutoTokenizer.from_pretrained(spec.name);
  const Cls = /** @type {any} */ (T)[spec.cls] ?? T.AutoModelForCausalLM;
  const model = await Cls.from_pretrained(spec.name, { dtype: spec.dtype ?? 'q4', device: 'cpu', session_options });
  return async (/** @type {{ role: string, content: string }[]} */ messages, /** @type {number} */ max) => {
    // (thinking off: Qwen's template knows it; the others pass it by)
    const options = /** @type {any} */ ({ add_generation_prompt: true, enable_thinking: false, return_dict: true });
    const inputs = /** @type {any} */ (tokenizer.apply_chat_template(/** @type {any} */ (messages), options));
    const out = /** @type {any} */ (await model.generate({ ...inputs, max_new_tokens: max, do_sample: false }));
    const promptLen = inputs.input_ids.dims[1];
    const text = tokenizer.batch_decode(out.slice(null, [promptLen, null]), { skip_special_tokens: true })[0];
    return { text: text.trim(), tokens: out.dims[1] - promptLen };
  };
}

/** @param {Writer} spec */
function writer(spec) {
  let run = writers.get(spec.name);
  if (!run) {
    run = loadWriter(spec);
    run.catch(() => writers.delete(spec.name));
    writers.set(spec.name, run);
  }
  return run;
}

// the server gone (stopped, restarted): so is this
process.on('disconnect', () => process.exit(0));

process.on('message', async (/** @type {any} */ m) => {
  try {
    if (m.op === 'write') {
      const { text, tokens } = await (await writer(m.spec))(m.messages, m.max);
      process.send?.({ id: m.id, text, tokens });
      return;
    }
    const { vectors, dims } = await (await model(m.spec))(m.texts);
    process.send?.({ id: m.id, vectors, dims });
  } catch (err) {
    process.send?.({ id: m.id, error: String(/** @type {Error} */ (err)?.message ?? err) });
  }
});
