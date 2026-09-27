// Stage 1 + 2 of the pipeline: get text out of the PDF, then normalise it.
// Both stages report what they did, so the UI can show it rather than assert it.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import path from 'node:path';

/** Pick the PDF to index: an explicit path, else the first PDF in dataDir. */
export function resolvePdfPath(dataDir, explicit) {
  if (explicit) return explicit;
  const pdfs = fs.readdirSync(dataDir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) throw new Error(`No PDF found in ${dataDir}. Drop one in and re-ingest.`);
  return path.join(dataDir, pdfs[0]);
}

/**
 * Rebuild lines from glyph geometry.
 *
 * A PDF has no concept of a line of text — only runs of glyphs at (x, y)
 * positions. pdfjs hands those back in reading order, so the naive move is to
 * join them all with a space. Doing that throws away every line and bullet
 * boundary in the document, which then denies the chunker anything to cut on
 * except commas. So: group runs by their y coordinate (transform[5]), and treat
 * a change in y as a line break.
 */
function itemsToLines(items) {
  const lines = [];
  let current = null;
  const Y_TOLERANCE = 2; // same visual line if within 2pt — guards sub/superscripts

  for (const item of items) {
    if (typeof item.str !== 'string' || item.str.length === 0) continue;
    const y = item.transform?.[5] ?? 0;
    if (current && Math.abs(current.y - y) <= Y_TOLERANCE) {
      current.parts.push(item.str);
    } else {
      if (current) lines.push(current);
      current = { y, parts: [item.str] };
    }
    if (item.hasEOL) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines.map((l) => l.parts.join('').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
}

/**
 * Extract text one page at a time, as lines. Page-level granularity is what
 * lets a chunk say "I came from page 4" later on — the single most useful thing
 * a citation can carry.
 */
export async function extractPages(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const numPages = doc.numPages;
  const pages = [];
  for (let n = 1; n <= numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items);
    pages.push({ page: n, lines, raw: lines.join('\n'), runs: content.items.length });
  }
  await doc.destroy();
  return { pages, numPages, file: path.basename(pdfPath) };
}

/**
 * Normalise a page's lines and record every edit class applied.
 *
 * PDF extraction is lossy in specific, boring ways: ligatures come back split
 * ("fi eld"), superscript footnote markers land as bare digits, and bullets
 * wrap onto continuation lines. None of it is fatal, but all of it pollutes an
 * embedding — so it is worth cleaning, and worth showing that we cleaned it.
 *
 * Newlines are deliberately preserved. They are the chunker's best cut points.
 */
export function normalisePage(lines) {
  const edits = [];
  const before = lines.join('\n');

  let out = lines.map((line) => {
    let t = line;
    // Ligature glyphs extract as a separate run: "field" arrives as "fi eld".
    t = t.replace(/\b(ffi|ffl|fi|fl|ff) (?=[a-z]{2,})/g, '$1');
    // Superscript footnote markers flatten into the text. Two shapes occur:
    // glued to the preceding word ('requirements4') because the superscript run
    // concatenates directly, or standalone after a space. Both are stripped, but
    // only after a LOWERCASE letter, so 'CSS3', 'HTML5' and 'Phase 2' survive.
    t = t.replace(/([a-z])\d{1,2}(?=\s|$|[●•])/g, '$1');
    t = t.replace(/(?<=[a-z),.])\s+\d{1,2}\s*$/g, '');
    t = t.replace(/(?<=[a-z),.])\s+\d{1,2}(?=\s+[●•])/g, '');
    return t.replace(/\s+([,.;:])/g, '$1').replace(/[ \t]+/g, ' ').trim();
  });

  // A wrapped bullet continues the bullet above it, not a new idea. Rejoining
  // keeps each bullet whole so a chunk boundary never lands mid-requirement.
  const joined = [];
  for (const line of out) {
    const isNewBlock = /^[●•\-\d]/.test(line) || /^[A-Z][^.!?]{0,60}$/.test(line);
    const prev = joined[joined.length - 1];
    if (!isNewBlock && prev && /[a-z,;:]$/.test(prev)) {
      joined[joined.length - 1] = `${prev} ${line}`;
    } else {
      joined.push(line);
    }
  }
  out = joined.filter(Boolean);

  const text = out.join('\n');
  if (text.length !== before.length) {
    edits.push({ kind: 'cleanup', detail: `${before.length} -> ${text.length} chars after ligature, footnote and wrap fixes` });
  }
  edits.push({ kind: 'lines', detail: `${lines.length} extracted lines -> ${out.length} logical lines (newlines kept as cut points)` });
  return { text, lines: out, edits };
}

/**
 * Join the normalised pages into one document, remembering where each page
 * starts and ends. Chunking then runs over the whole document (so a chunk may
 * legitimately straddle a page break) while still being able to name its pages.
 */
export function buildDocument(pages) {
  const JOIN = '\n\n';
  let text = '';
  const pageSpans = [];
  const pageReports = [];

  pages.forEach((p, i) => {
    const { text: clean, lines, edits } = normalisePage(p.lines);
    const start = text.length;
    text += clean;
    pageSpans.push({ page: p.page, start, end: text.length });
    pageReports.push({
      page: p.page,
      runs: p.runs,
      rawChars: p.raw.length,
      cleanChars: clean.length,
      lines: lines.length,
      edits,
    });
    if (i < pages.length - 1) text += JOIN;
  });

  return { text, pageSpans, pageReports };
}

/** Which pages does the character range [start, end) touch? */
export function pagesForSpan(pageSpans, start, end) {
  return pageSpans.filter((s) => s.start < end && s.end > start).map((s) => s.page);
}
