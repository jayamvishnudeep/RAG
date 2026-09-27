# Design notes — RAG Explorer

Why this app is shaped the way it is, what was measured, and what was ruled out.
The [README](README.md) is the clone-and-run guide; this is the argument behind it.

## The brief

Build a very simple RAG over one confidential PRD, with a lightweight React UI
that explains the mechanism to an audience rather than just answering questions.
Show how the PDF becomes chunks. Show how a search picks the top chunks. Show the
weights. Free and open-source embeddings and vector database; Groq's
`gpt-oss-120b` for generation. Let the chunk size and overlap be adjustable from
the UI.

Two consequences follow from "explain to everyone", and they drove every decision:

1. **Nothing may be a black box.** If the app computes a similarity, it shows the
   number. If it sends a prompt, it shows the prompt. A demo that says "and then
   the magic happens" teaches nothing.
2. **It has to start first time.** A teaching demo that needs a Docker daemon and
   a model download and a Python environment is a demo you cannot give. Every
   dependency was chosen against that constraint.

## Stack decisions

### Vector database: three attempts

The brief said Chroma or Qdrant, "or any lightweight one". Both named options
failed on this machine, which is worth recording because the failure modes are
not obvious:

- **Chroma** — `chromadb@3.5.0` ships a `chroma` CLI on npm, which looked ideal:
  a real vector DB with no Python and no Docker. It refuses to run on Windows
  x64: `Unsupported Windows architecture: x64. Only ARM64 is supported.` The npm
  distribution only carries an ARM64 Windows binary.
- **Qdrant** — needs a running Docker daemon. Docker 26 is installed here but
  the daemon was not running, and "start Docker Desktop first" is exactly the
  friction that kills a demo.
- **LanceDB** — embedded, prebuilt for win32-x64, runs in-process like SQLite.
  Verified before committing to it: `createTable`, `vectorSearch`,
  `distanceType('cosine')`, and the `_distance` → similarity conversion all
  behave. This is what shipped.

LanceDB being embedded has a pedagogical cost worth naming: there is no server to
point at, so the "database" is less visible than it would be with a Qdrant
dashboard open beside the app. The Search tab compensates by showing the distance
the store returned *and* the conversion to similarity, so the store's actual
output is on screen rather than implied.

### Embeddings: Nomic, locally, quantised

`nomic-embed-text-v1.5` as the brief asked, run through
`@huggingface/transformers` in-process rather than through Ollama or a Python
service — one fewer thing to install, and it makes "this never leaves your
machine" literally true rather than a claim about a localhost port.

The Q8 quantisation was checked rather than assumed, because int8 quantisation
can flatten an embedding space badly. Measured on a query and three passages:

| Passage | Cosine to *"How fast must the login page load?"* |
|---|---|
| The load-time requirement | **0.8104** |
| Error handling (adjacent topic) | 0.5445 |
| Biometrics (unrelated) | 0.4505 |

A 0.36 spread with the right passage first — the quantisation is fine, and it
saves ~400 MB against fp32. An fp32 comparison was attempted but Hugging Face
timed out mid-download; since q8 had already demonstrated clean separation, it
was not worth retrying.

The task prefixes matter and are surfaced in the UI for that reason. Nomic is
trained with `search_document:` on passages and `search_query:` on questions.
Omitting them compares two things the model was taught to place in different
regions of the space.

## Two real bugs found by measuring

Both were caught because retrieval quality was tested against known answers
rather than eyeballed. Both would have shipped silently.

### 1. Whitespace normalisation destroyed every chunk boundary

The first `normalisePage` did `text.replace(/\s+/g, ' ')` — the obvious way to
tidy extracted text, and it collapsed every newline in the document. The chunker
was then left with nothing to cut on except commas: **12 of 18 chunks were cut
mid-clause**, each one straddling several unrelated topics.

The deeper cause is that a PDF has no lines. It stores runs of glyphs at (x, y)
coordinates, and `pdfjs` returns them in reading order; joining them with spaces
is lossy in a way that is invisible until you look at what the chunker did with
the result. The fix reconstructs lines from the y coordinate of each run
(`transform[5]`), treating a change in y as a line break, then keeps those
newlines through normalisation.

| | before | after |
|---|---|---|
| Correct chunk's rank for the load-time question | 2 (sim 0.607) | **1 (sim 0.692)** |
| Score spread across all chunks | 0.114 | **0.213** |
| Chunks cut on structure (paragraph/bullet/line) | 3 of 18 | **17 of 19** |

### 2. Every chunk started mid-word

Overlap was implemented as `pos = end - overlap`, which is correct arithmetic and
wrong behaviour: stepping back a fixed number of characters lands wherever it
lands. Chunks opened with `"ity policies and…"`, `"ogin process with…"`,
`"mail-based reset"`. Noise inside the embedding, and baffling to look at in an
inspector whose entire purpose is to be looked at.

The fix treats the overlap as a target rather than a promise: step back by
`overlap`, then snap *forward* to the next line break, sentence end or space,
within a capped window so the snap can never consume the whole overlap. Chunks
now open on whole words — usually on a bullet — and each one reports the overlap
it actually received (83–119 characters against a target of 120) rather than the
overlap that was requested.

## What the sliders demonstrate

This is the measurement that justifies the app existing. Same document, same
model, same questions; only chunk size changed. "Rank" is where the chunk
containing the actual answer landed:

| chunk size | chunks | load-time question | accessibility question | Phase 1 question |
|---|---|---|---|---|
| 700 | 18 | rank 2 (0.647) | rank 2 (0.667) | rank 2 (0.526) |
| 350 | 32 | rank 2 (0.749) | rank 3 (0.684) | **rank 1** (0.555) |
| 220 | 53 | **rank 1** (0.771) | **rank 1** (0.725) | **rank 1** (0.535) |

Smaller chunks sharpen both the rank and the absolute similarity. The mechanism
is worth saying out loud because it is the single most useful intuition in
practical RAG: a 700-character chunk spanning four topics is a weak match for
every question, while a 220-character chunk about one topic is a strong match for
questions about that topic. Nothing about the model changed.

The ground-truth chunk was always inside the top 3, at every setting — retrieval
was never broken, it was *unfocused*. That distinction is easy to miss from
looking at answers alone, and it is why the Search tab draws the full ranking
with the cut-off marked instead of only the three winners.

Defaults ship at 400/80: good retrieval, ~28 chunks (enough to make the
distribution chart meaningful), and room to slide usefully in both directions.

## UI decisions

**Three tabs, one per stage of the acronym.** Retrieval is deliberately separated
from generation so the Search tab can prove that retrieval is ordinary arithmetic
with no language model anywhere near it — the most common misconception about how
RAG works.

**The document map is drawn to scale.** Overlap is the hardest part of chunking
to explain in words and the easiest to show: yellow slivers, visibly the same
text in two adjacent bands. Page breaks are dashed lines, and chunks visibly
cross them, which pre-empts the reasonable assumption that chunks respect pages.

**Every chunk is scored on the Search tab, not just the top-K.** A top-K list
hides whether rank 3 beat rank 4 by 0.2 or by 0.003. The distribution chart is
scaled to the actual score range rather than 0–1, because cosine scores on real
prose occupy a narrow band and a 0–1 axis renders every bar identically. The
panel says plainly that scoring everything defeats the purpose of an index and is
only affordable because the corpus is tiny — and notes that the brute-force
ranking and LanceDB's index agree, which is the reassuring part.

**The full prompt is shown, expanded on request.** "What exactly did you send the
model?" is the question that makes RAG click, and it is the thing demos hide.

**Colour is a legend, not decoration.** The first build was a neutral grey-on-white
admin panel — correct and forgettable. The rebuild is dark-first with a fixed
spectrum: violet for the brand and the chunking machinery, cyan for retrieval
(page tags, query vectors, citations), amber for overlap, emerald for the rank-1
hit. Because each hue means one thing everywhere, the amber slivers in the
document map and the amber highlights inside a chunk card are recognisably the
same fact without a caption. A light palette exists for projectors, switched by
the button in the masthead; dark is the default and the one the design is tuned
for.

**A mark, not a wordmark.** Three stacked bars — a document cut into chunks —
with one of them lit and ringed: the chunk a query just found. Four shapes, so it
survives being shrunk to a favicon, which is where it is also used (inlined as a
data URI in `index.html`, so the tab icon costs no request).

**One deliberately unanswerable example question.** A RAG system that cannot say
"I don't know" is worse than none, because a confident invention reads exactly
like a correct answer. The refusal path is verified: asked about a refund policy,
retrieval returns its three least-bad chunks at ~0.57 similarity and the model
answers *"That is not in the retrieved context."* The UI then explains why that
is the correct outcome, and the low similarities are visible beside it.

## Verification performed

- PDF extraction: 7 pages, 9,882 raw → 9,398 normalised characters.
- Normalisation guard tests: footnote markers stripped (`requirements4` →
  `requirements`) while `CSS3`, `HTML5`, `Phase 2`, `2 seconds` and `90%` are
  left intact. This regex is the kind that quietly eats real content, so the
  cases that must survive were asserted explicitly.
- Embedding: 768 dimensions, L2 norm 1.0, so cosine is a plain dot product.
- LanceDB: ranking cross-checked against a brute-force dot product over all
  vectors — identical ordering.
- Chat: Groq responded in ~1.1 s, cited `[chunk 1]`/`[chunk 2]` correctly, and
  quoted the document's own "within 2 seconds" wording.
- Refusal: verified as described above.
- UI: driven in headless Chromium — all three tabs, the example queries, and a
  chunk-size slider change confirmed to re-ingest and change the chunk count.

One rendering bug was found only by opening a real browser: `vite.config.js`
imported `@vitejs/plugin-react` but never added it to `plugins`, so JSX compiled
with the classic runtime and the page died with `React is not defined`. The build
succeeded regardless. Worth remembering that a green `vite build` says nothing
about whether the page renders.

## Confidentiality

The PRD is confidential, so:

- `.gitignore` excludes `data/*.pdf`, `.env`, `.models/` and `.lancedb/`. Both
  exclusions were verified with `git check-ignore` rather than assumed.
- The document is never uploaded. Extraction, chunking, embedding and search all
  happen locally.
- The only egress is the Groq call, which carries the retrieved excerpts —
  typically 3 chunks, ~1 KB — and not the document. The Chat tab states this, and
  the exact bytes are inspectable in the prompt panel before anyone has to trust
  the claim.
- Nothing from this app was published to a hosted artifact or any external
  service.

## Ideas not pursued

- **Hybrid retrieval (BM25 + vector).** Would improve results on exact-term
  questions like "Phase 1", which is the weakest case in the table above. Left
  out because two retrievers and a fusion step would obscure the one mechanism
  the app exists to show.
- **A reranker.** Same reasoning; it is the correct next step for quality and the
  wrong next step for clarity.
- **Streaming the answer.** Nicer to watch, but it would make the timing figures
  harder to read.
- **Multi-document support.** The chunk-provenance story gets better with several
  documents, but the document map stops working as a single scale drawing.
