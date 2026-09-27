// Stage 3: cut the document into overlapping chunks.
//
// This is the knob that matters most in a RAG system and the one people
// understand least, which is why the UI drives it with two sliders. The
// algorithm here is deliberately simple enough to explain out loud:
//
//   1. Walk forward from the current position by `chunkSize` characters.
//   2. Rather than cut mid-word, look BACKWARDS from that point for the best
//      available boundary — paragraph break, then line break, then sentence
//      end, then any space — but only within the last `lookback` fraction of
//      the chunk, so a boundary hunt can never shrink a chunk to nothing.
//   3. Start the next chunk `overlap` characters before this one ended, so a
//      sentence split across the seam still appears whole in one of them.
//
// Every chunk carries its exact character span, which is what lets the UI
// highlight the overlap and attribute pages without guessing.

import { pagesForSpan } from './pdf.js';

/** Boundary preferences, best first. Each is [regex, label]. */
const SEPARATORS = [
  [/\n\n/g, 'paragraph break'],
  [/\n(?=[●•])/g, 'bullet start'],
  [/\n/g, 'line break'],
  [/(?<=[.!?])\s/g, 'sentence end'],
  [/(?<=[;:,])\s/g, 'clause break'],
  [/\s/g, 'word space'],
];

/**
 * Move a chunk's START forward to the next clean boundary.
 *
 * Stepping back by `overlap` characters lands wherever it lands — usually
 * mid-word, which is how you end up with a chunk that opens "ity policies and".
 * That is bad twice over: it is noise inside the embedding, and it is baffling
 * to look at in the inspector. So the overlap is treated as a target rather
 * than a promise, and the real start is snapped forward to the nearest sensible
 * boundary. The chunk then reports the overlap it actually got.
 */
function snapForward(text, from, window) {
  if (from <= 0) return 0;
  const to = Math.min(from + window, text.length);
  const slice = text.slice(from, to);
  for (const [re] of [[/\n/], [/(?<=[.!?])\s/], [/\s/]]) {
    const m = slice.match(re);
    if (m && m.index !== undefined) {
      let at = from + m.index + m[0].length;
      // Skip any further whitespace, so a chunk never opens on a blank line.
      while (at < text.length && /\s/.test(text[at])) at++;
      return at;
    }
  }
  return from;
}

/** Last index of a separator inside text[from, to), or -1. */
function lastBoundary(text, from, to, regex) {
  const window = text.slice(from, to);
  let found = -1;
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(window)) !== null) {
    found = m.index + m[0].length;
    if (m.index === regex.lastIndex) regex.lastIndex++;
  }
  return found === -1 ? -1 : from + found;
}

/**
 * @param {string} text        the normalised document
 * @param {object} opts
 * @param {number} opts.chunkSize  target characters per chunk
 * @param {number} opts.overlap    characters each chunk shares with the previous
 * @param {number} opts.lookback   fraction of the chunk a boundary may claw back (0.3 = 30%)
 * @param {Array}  opts.pageSpans  page offsets from buildDocument()
 */
export function chunkDocument(text, { chunkSize, overlap, lookback = 0.3, pageSpans = [] }) {
  // Hard guards. An overlap >= chunkSize cannot make forward progress and would
  // loop for ever, so it is clamped rather than trusted.
  const size = Math.max(50, Math.floor(chunkSize));
  const lap = Math.min(Math.max(0, Math.floor(overlap)), Math.floor(size * 0.8));
  const minCut = Math.max(1, Math.floor(size * (1 - lookback)));

  const chunks = [];
  let pos = 0;

  while (pos < text.length) {
    const hardEnd = Math.min(pos + size, text.length);
    let end = hardEnd;
    let cutOn = 'hard limit';

    if (hardEnd < text.length) {
      for (const [regex, label] of SEPARATORS) {
        const at = lastBoundary(text, pos + minCut, hardEnd, regex);
        if (at > pos) {
          end = at;
          cutOn = label;
          break;
        }
      }
    } else {
      cutOn = 'end of document';
    }

    const body = text.slice(pos, end);
    const prev = chunks[chunks.length - 1];
    // How much of this chunk's head is text the previous chunk also held?
    const overlapPrev = prev ? Math.max(0, prev.charEnd - pos) : 0;

    chunks.push({
      id: `chunk-${chunks.length}`,
      index: chunks.length,
      text: body,
      charStart: pos,
      charEnd: end,
      chars: body.length,
      tokensEst: Math.max(1, Math.round(body.length / 4)),
      pages: pagesForSpan(pageSpans, pos, end),
      cutOn,
      overlapPrev,
      overlapPrevText: overlapPrev > 0 ? body.slice(0, overlapPrev) : '',
    });

    if (end >= text.length) break;
    // Step back by the overlap, then snap forward so the next chunk opens on a
    // whole word. The snap window is capped at HALF the overlap: allowing it to
    // search the full width let it skip past the previous chunk's end entirely,
    // which silently produced seams with no overlap at all.
    const target = end - lap;
    const snapped = snapForward(text, target, Math.max(1, Math.min(Math.floor(lap / 2), 60)));
    pos = snapped > pos ? snapped : end; // never go backwards or stall
  }

  // Fill in the forward-looking half of each seam now that all chunks exist.
  chunks.forEach((c, i) => {
    const nxt = chunks[i + 1];
    c.overlapNext = nxt ? Math.max(0, c.charEnd - nxt.charStart) : 0;
    c.overlapNextText = c.overlapNext > 0 ? c.text.slice(c.text.length - c.overlapNext) : '';
  });

  return { chunks, effective: { chunkSize: size, overlap: lap, minCut, lookback } };
}

/** Summary stats the UI shows above the chunk grid. */
export function chunkStats(chunks) {
  if (chunks.length === 0) return { count: 0, avgChars: 0, minChars: 0, maxChars: 0, tokensEst: 0, cutReasons: {} };
  const sizes = chunks.map((c) => c.chars);
  const cutReasons = {};
  for (const c of chunks) cutReasons[c.cutOn] = (cutReasons[c.cutOn] || 0) + 1;
  return {
    count: chunks.length,
    avgChars: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length),
    minChars: Math.min(...sizes),
    maxChars: Math.max(...sizes),
    tokensEst: chunks.reduce((a, c) => a + c.tokensEst, 0),
    cutReasons,
  };
}
