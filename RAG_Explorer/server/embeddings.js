// Stage 4: turn text into vectors, locally.
//
// Model: nomic-ai/nomic-embed-text-v1.5, the Q8-quantised ONNX build, run
// in-process by Transformers.js. No API call, no key, no per-token cost — the
// weights sit in ./.models after the first run (~132 MB) and everything after
// that is offline.
//
// The one non-obvious thing about this model: it is trained with task
// prefixes. A passage must be embedded as "search_document: <text>" and a
// question as "search_query: <text>". Skip the prefixes and retrieval quality
// drops measurably, because you are asking the model to compare two things it
// was taught to place in different regions of the space. The UI shows the
// prefix being applied for exactly this reason.

import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = './.models';
env.allowLocalModels = true;

export const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';
export const DIMS = 768;
export const DOC_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';

let extractor = null;
let loading = null;
let loadMs = null;

/** Load once, reuse for the life of the process. */
export async function getExtractor(onProgress) {
  if (extractor) return extractor;
  if (loading) return loading;
  const t0 = Date.now();
  loading = pipeline('feature-extraction', MODEL_ID, {
    dtype: 'q8',
    progress_callback: onProgress,
  }).then((p) => {
    extractor = p;
    loadMs = Date.now() - t0;
    loading = null;
    return p;
  });
  return loading;
}

export function modelState() {
  return { model: MODEL_ID, dims: DIMS, loaded: extractor !== null, loadMs, quantisation: 'q8' };
}

/**
 * Embed passages. Batched, because one forward pass over 20 short strings is
 * far cheaper than 20 passes over one.
 */
export async function embedDocuments(texts, { batchSize = 16, onBatch } = {}) {
  const fe = await getExtractor();
  const vectors = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => DOC_PREFIX + t);
    const out = await fe(batch, { pooling: 'mean', normalize: true });
    vectors.push(...out.tolist());
    if (onBatch) onBatch(Math.min(i + batchSize, texts.length), texts.length);
  }
  return vectors;
}

/** Embed one question. Same model, different prefix. */
export async function embedQuery(text) {
  const fe = await getExtractor();
  const out = await fe([QUERY_PREFIX + text], { pooling: 'mean', normalize: true });
  return out.tolist()[0];
}

/**
 * Cosine similarity. Both vectors are already L2-normalised by the extractor,
 * so this is just a dot product — but it is written out in full because the
 * whole point of this app is that nothing is a black box.
 */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
