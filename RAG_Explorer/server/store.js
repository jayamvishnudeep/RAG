// Stage 5: the vector database.
//
// LanceDB, embedded. It is a real vector store — columnar, on disk, ANN-capable
// — but it runs in this process like SQLite does, so there is no server to
// start, no Docker image to pull and no port to clash. That matters for a demo
// whose job is to run first time on someone else's laptop.
//
// (Chroma's npm CLI ships a Windows binary for ARM64 only, and Qdrant needs a
// running Docker daemon. Both are fine choices on other machines; neither could
// start on this one. See plan.md.)

import * as lancedb from '@lancedb/lancedb';
import fs from 'node:fs';

const DB_DIR = './.lancedb';
const TABLE = 'chunks';

let db = null;
let table = null;

async function connect() {
  if (!db) db = await lancedb.connect(DB_DIR);
  return db;
}

/** Replace the whole table. Re-ingesting with new slider values starts clean. */
export async function replaceAll(rows) {
  const conn = await connect();
  table = await conn.createTable(TABLE, rows, { mode: 'overwrite' });
  return table.countRows();
}

async function getTable() {
  if (table) return table;
  const conn = await connect();
  const names = await conn.tableNames();
  if (!names.includes(TABLE)) return null;
  table = await conn.openTable(TABLE);
  return table;
}

export async function isPopulated() {
  const t = await getTable();
  return t ? (await t.countRows()) > 0 : false;
}

export async function countRows() {
  const t = await getTable();
  return t ? t.countRows() : 0;
}

/**
 * Nearest neighbours by cosine distance.
 *
 * LanceDB returns `_distance`; for cosine that is `1 - similarity`, so the
 * similarity the UI draws as a bar is `1 - _distance`. The conversion is done
 * here, once, and labelled, so nobody has to wonder whether a big number is
 * good or bad.
 */
export async function search(queryVector, limit) {
  const t = await getTable();
  if (!t) return [];
  const hits = await t.vectorSearch(queryVector).distanceType('cosine').limit(limit).toArray();
  return hits.map((h) => ({
    id: h.id,
    index: h.index,
    text: h.text,
    pages: JSON.parse(h.pages_json),
    chars: h.chars,
    tokensEst: h.tokens_est,
    distance: h._distance,
    similarity: 1 - h._distance,
  }));
}

/** Wipe the store so a fresh ingest cannot inherit stale rows. */
export function reset() {
  table = null;
  db = null;
  fs.rmSync(DB_DIR, { recursive: true, force: true });
}

export function storeInfo() {
  return { engine: 'LanceDB (embedded)', path: DB_DIR, table: TABLE, metric: 'cosine' };
}
