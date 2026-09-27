// The API. Six endpoints, one per question the UI needs to answer:
//   what is loaded, ingest with these settings, what did ingesting produce,
//   search this, answer this, and reset.
//
// Every response carries the numbers behind it — timings, counts, vectors,
// similarities — because the UI's job is to show the pipeline, not to claim it.

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { resolvePdfPath, extractPages, buildDocument } from './pdf.js';
import { chunkDocument, chunkStats } from './chunker.js';
import {
  embedDocuments,
  embedQuery,
  modelState,
  getExtractor,
  MODEL_ID,
  DIMS,
  DOC_PREFIX,
  QUERY_PREFIX,
} from './embeddings.js';
import * as store from './store.js';
import { generate, buildPrompt, MODEL as LLM_MODEL } from './llm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DATA_DIR = path.resolve(ROOT, 'data');

// The key lives in RAG_Explorer/.env, which .gitignore excludes. The parent
// folder is also checked, so an existing 10_RAG/.env still works.
dotenv.config({ path: path.resolve(ROOT, '.env'), quiet: true });
dotenv.config({ path: path.resolve(ROOT, '..', '.env'), quiet: true });

const PORT = process.env.PORT || 5174;
const DEFAULTS = { chunkSize: 400, overlap: 80, topK: 3 };

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Everything the last ingest produced. Held in memory so the UI can page
// through chunks and inspect vectors without re-querying the store.
let state = {
  ingested: false,
  params: { ...DEFAULTS },
  file: null,
  numPages: 0,
  docChars: 0,
  pageReports: [],
  pageSpans: [],
  chunks: [],
  vectors: [],
  stats: null,
  timings: null,
  ingestedAt: null,
};

const vectorPreview = (v, n = 24) => v.slice(0, n).map((x) => Number(x.toFixed(4)));
const l2norm = (v) => Number(Math.sqrt(v.reduce((s, x) => s + x * x, 0)).toFixed(6));

/** A chunk plus a glimpse of its vector — never all 768 floats. */
function chunkPayload(c, i) {
  const v = state.vectors[i];
  return {
    ...c,
    vectorPreview: v ? vectorPreview(v) : null,
    vectorNorm: v ? l2norm(v) : null,
  };
}

app.get('/api/status', async (req, res) => {
  const pdfs = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'))
    : [];
  res.json({
    ok: true,
    pipeline: {
      embedding: modelState(),
      store: store.storeInfo(),
      llm: { model: LLM_MODEL, keyPresent: Boolean(process.env.GROQ_API_KEY) },
      prefixes: { document: DOC_PREFIX, query: QUERY_PREFIX },
    },
    data: { dir: DATA_DIR, pdfs },
    defaults: DEFAULTS,
    ingest: state.ingested
      ? {
          ingested: true,
          file: state.file,
          numPages: state.numPages,
          docChars: state.docChars,
          params: state.params,
          stats: state.stats,
          timings: state.timings,
          ingestedAt: state.ingestedAt,
          rows: Number(await store.countRows()),
        }
      : { ingested: false },
  });
});

/**
 * The whole pipeline, start to finish, with the caller's chunk settings.
 * Re-runnable: moving a slider calls this again and the store is replaced.
 */
app.post('/api/ingest', async (req, res) => {
  try {
    const chunkSize = Number(req.body?.chunkSize ?? DEFAULTS.chunkSize);
    const overlap = Number(req.body?.overlap ?? DEFAULTS.overlap);
    if (!Number.isFinite(chunkSize) || !Number.isFinite(overlap)) {
      return res.status(400).json({ error: 'chunkSize and overlap must be numbers.' });
    }

    const timings = {};
    let t = Date.now();

    const pdfPath = resolvePdfPath(DATA_DIR, req.body?.pdfPath);
    const { pages, numPages, file } = await extractPages(pdfPath);
    timings.extractMs = Date.now() - t;

    t = Date.now();
    const { text, pageSpans, pageReports } = buildDocument(pages);
    timings.normaliseMs = Date.now() - t;

    t = Date.now();
    const { chunks, effective } = chunkDocument(text, { chunkSize, overlap, pageSpans });
    timings.chunkMs = Date.now() - t;

    t = Date.now();
    await getExtractor();
    timings.modelLoadMs = Date.now() - t;

    t = Date.now();
    const vectors = await embedDocuments(chunks.map((c) => c.text));
    timings.embedMs = Date.now() - t;

    t = Date.now();
    store.reset();
    const rows = chunks.map((c, i) => ({
      id: c.id,
      index: c.index,
      text: c.text,
      chars: c.chars,
      tokens_est: c.tokensEst,
      pages_json: JSON.stringify(c.pages),
      vector: vectors[i],
    }));
    const stored = await store.replaceAll(rows);
    timings.storeMs = Date.now() - t;
    timings.totalMs = Object.entries(timings)
      .filter(([k]) => k !== 'totalMs')
      .reduce((a, [, v]) => a + v, 0);

    const stats = chunkStats(chunks);

    state = {
      ingested: true,
      params: {
        chunkSize: effective.chunkSize,
        overlap: effective.overlap,
        requested: { chunkSize, overlap },
      },
      file,
      numPages,
      docChars: text.length,
      pageReports,
      pageSpans,
      chunks,
      vectors,
      stats,
      timings,
      ingestedAt: new Date().toISOString(),
    };

    res.json({
      ok: true,
      file,
      numPages,
      docChars: text.length,
      rawChars: pages.reduce((a, p) => a + p.raw.length, 0),
      params: state.params,
      effective,
      stats,
      timings,
      rowsStored: Number(stored),
      pageReports,
      pageSpans,
      embedding: modelState(),
      store: store.storeInfo(),
      chunks: chunks.map((c, i) => chunkPayload(c, i)),
    });
  } catch (err) {
    console.error('[ingest]', err);
    res.status(500).json({ error: err.message });
  }
});

/** The chunks from the last ingest, for the inspector tab. */
app.get('/api/chunks', (req, res) => {
  if (!state.ingested) return res.status(409).json({ error: 'Nothing ingested yet.' });
  res.json({
    file: state.file,
    params: state.params,
    stats: state.stats,
    docChars: state.docChars,
    pageSpans: state.pageSpans,
    chunks: state.chunks.map((c, i) => chunkPayload(c, i)),
  });
});

/**
 * Retrieval only — no LLM. Returns the ranked hits AND the full ranking of
 * every chunk, so the UI can show what just missed the cut.
 */
app.post('/api/search', async (req, res) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    const topK = Math.max(1, Math.min(10, Number(req.body?.topK ?? DEFAULTS.topK)));
    if (!query) return res.status(400).json({ error: 'Empty query.' });
    if (!state.ingested) return res.status(409).json({ error: 'Ingest the PDF first.' });

    let t = Date.now();
    const qv = await embedQuery(query);
    const embedMs = Date.now() - t;

    t = Date.now();
    const hits = await store.search(qv, topK);
    const searchMs = Date.now() - t;

    // Score every chunk too, so the UI can draw the whole distribution and the
    // cut-off line. Cheap here (tens of chunks); you would not do this at scale,
    // which is precisely the reason a vector index exists.
    const ranking = state.vectors
      .map((v, i) => ({ index: i, similarity: v.reduce((s, x, k) => s + x * qv[k], 0) }))
      .sort((a, b) => b.similarity - a.similarity)
      .map((r, i) => ({ ...r, rank: i + 1, similarity: Number(r.similarity.toFixed(6)) }));

    res.json({
      ok: true,
      query,
      embeddedAs: QUERY_PREFIX + query,
      topK,
      timings: { embedMs, searchMs },
      queryVector: { dims: qv.length, preview: vectorPreview(qv), norm: l2norm(qv) },
      hits: hits.map((h, i) => ({
        rank: i + 1,
        ...h,
        similarity: Number(h.similarity.toFixed(6)),
        distance: Number(h.distance.toFixed(6)),
      })),
      ranking,
      chunkCount: state.chunks.length,
    });
  } catch (err) {
    console.error('[search]', err);
    res.status(500).json({ error: err.message });
  }
});

/** Retrieve, then augment, then generate — and return all three. */
app.post('/api/chat', async (req, res) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    const topK = Math.max(1, Math.min(10, Number(req.body?.topK ?? DEFAULTS.topK)));
    if (!query) return res.status(400).json({ error: 'Empty question.' });
    if (!state.ingested) return res.status(409).json({ error: 'Ingest the PDF first.' });

    let t = Date.now();
    const qv = await embedQuery(query);
    const embedMs = Date.now() - t;

    t = Date.now();
    const hits = await store.search(qv, topK);
    const retrieveMs = Date.now() - t;

    const result = await generate(query, hits, process.env.GROQ_API_KEY);

    res.json({
      ok: true,
      query,
      answer: result.answer,
      model: result.model,
      usage: result.usage,
      timings: { embedMs, retrieveMs, generateMs: result.latencyMs },
      prompt: result.prompt,
      chunks: hits.map((h, i) => ({
        label: `chunk ${i + 1}`,
        ...h,
        similarity: Number(h.similarity.toFixed(6)),
        distance: Number(h.distance.toFixed(6)),
      })),
    });
  } catch (err) {
    console.error('[chat]', err);
    const status = err.code === 'NO_KEY' ? 400 : 500;
    res.status(status).json({ error: err.message, code: err.code ?? null });
  }
});

/** Preview the assembled prompt without spending a Groq call. */
app.post('/api/prompt-preview', async (req, res) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    const topK = Math.max(1, Math.min(10, Number(req.body?.topK ?? DEFAULTS.topK)));
    if (!query || !state.ingested) {
      return res.status(400).json({ error: 'Need a query and an ingested document.' });
    }
    const qv = await embedQuery(query);
    const hits = await store.search(qv, topK);
    res.json({ ok: true, prompt: buildPrompt(query, hits), chunks: hits.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  store.reset();
  state = { ...state, ingested: false, chunks: [], vectors: [], stats: null, timings: null };
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  RAG Explorer API   http://localhost:${PORT}`);
  console.log(`  embeddings         ${MODEL_ID} (${DIMS}d, local)`);
  console.log(`  vector store       LanceDB (embedded)`);
  console.log(`  generation         ${LLM_MODEL} via Groq`);
  console.log(`  GROQ_API_KEY       ${process.env.GROQ_API_KEY ? 'loaded' : 'MISSING - chat tab will not answer'}`);
  console.log(`  documents          ${DATA_DIR}\n`);
});
