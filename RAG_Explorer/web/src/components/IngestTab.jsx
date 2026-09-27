import { useMemo, useState } from 'react';
import { Fig, Fold, Note, Panel, Spark, Stage } from './bits.jsx';

/**
 * A scale drawing of the document, one band, with every chunk drawn in place.
 *
 * This is the picture that makes overlap concrete: the yellow slivers are text
 * that deliberately appears in two chunks, so a sentence cut by a boundary is
 * still whole somewhere. Dashed lines are page breaks — note that chunks cross
 * them, because the chunker works on the document, not on pages.
 */
function DocumentMap({ chunks, docChars, pageSpans, selected, onSelect }) {
  const pct = (n) => `${(n / docChars) * 100}%`;
  return (
    <>
      <div className="docmap">
        {chunks.map((c, i) => (
          <div
            key={c.id}
            className="seg"
            onClick={() => onSelect(c.index === selected ? null : c.index)}
            title={`chunk ${c.index} · ${c.chars} chars · page ${c.pages.join(', ')} · cut on ${c.cutOn}`}
            style={{
              left: pct(c.charStart),
              width: pct(c.charEnd - c.charStart),
              // Alternating violet/cyan so adjacent chunks are individually
              // countable; the selected one goes solid.
              background:
                c.index === selected
                  ? 'var(--violet)'
                  : i % 2
                    ? 'rgba(146, 132, 255, 0.72)'
                    : 'rgba(45, 212, 235, 0.6)',
            }}
          />
        ))}
        {chunks.map((c) =>
          c.overlapPrev > 0 ? (
            <div
              key={`lap-${c.id}`}
              className="lap"
              title={`${c.overlapPrev} characters shared with chunk ${c.index - 1}`}
              style={{ left: pct(c.charStart), width: pct(c.overlapPrev) }}
            />
          ) : null,
        )}
        {pageSpans.slice(1).map((p) => (
          <div key={p.page} className="pg" style={{ left: pct(p.start) }}>
            <span className="pglabel">p{p.page}</span>
          </div>
        ))}
      </div>
      <div className="maplegend">
        <span>
          <i className="swatch" style={{ background: 'linear-gradient(90deg, rgba(146,132,255,0.72), rgba(45,212,235,0.6))' }} />
          chunk
        </span>
        <span><i className="swatch" style={{ background: 'var(--amber)' }} />overlap (text in two chunks)</span>
        <span><i className="swatch" style={{ background: 'var(--ink-3)' }} />page break</span>
        <span className="muted">click a band to pin that chunk below</span>
      </div>
    </>
  );
}

/** Chunk text with the overlapping head and tail marked. */
function ChunkText({ chunk }) {
  const { text, overlapPrev = 0, overlapNext = 0 } = chunk;
  const headEnd = Math.min(overlapPrev, text.length);
  const tailStart = Math.max(headEnd, text.length - overlapNext);
  return (
    <div className="chunk-text">
      {headEnd > 0 && <mark title={`shared with chunk ${chunk.index - 1}`}>{text.slice(0, headEnd)}</mark>}
      {text.slice(headEnd, tailStart)}
      {tailStart < text.length && <mark title={`shared with chunk ${chunk.index + 1}`}>{text.slice(tailStart)}</mark>}
    </div>
  );
}

export default function IngestTab({ ingest, busy }) {
  const [selected, setSelected] = useState(null);
  const [showAll, setShowAll] = useState(false);

  // Every hook has to run on every render, including the renders that bail out
  // below — so this is computed here, defensively, rather than next to the
  // markup that uses it.
  const duplication = useMemo(() => {
    if (!ingest?.chunks?.length || !ingest.docChars) return 0;
    const shared = ingest.chunks.reduce((a, c) => a + (c.overlapPrev || 0), 0);
    return (shared / ingest.docChars) * 100;
  }, [ingest]);

  if (busy && !ingest) {
    return (
      <div className="empty">
        <span className="spin" /> Running the pipeline — first run also loads the embedding model.
      </div>
    );
  }
  if (!ingest) {
    return <div className="empty">Nothing ingested yet. Press <b>Re-ingest</b> above to run the pipeline.</div>;
  }

  const { stats, timings, chunks, pageReports, pageSpans, docChars, rawChars, numPages, file, effective, embedding, store } = ingest;
  const visible = showAll ? chunks : chunks.slice(0, 12);
  const pinned = selected !== null ? chunks.find((c) => c.index === selected) : null;

  return (
    <>
      <Panel
        title="The pipeline that just ran"
        sub={`${file} · every stage below ran on this machine, nothing left it`}
      >
        <div className="stages">
          <Stage n="01" title="Extract" value={`${numPages} pages`} ms={timings.extractMs} />
          <Stage n="02" title="Normalise" value={`${rawChars} → ${docChars} chars`} ms={timings.normaliseMs} />
          <Stage n="03" title="Chunk" value={`${stats.count} chunks`} ms={timings.chunkMs} />
          <Stage n="04" title="Embed" value={`${stats.count} × ${embedding.dims}d`} ms={timings.embedMs} />
          <Stage n="05" title="Store" value={`${ingest.rowsStored} rows`} ms={timings.storeMs} />
        </div>
        <div className="row tiny muted" style={{ marginTop: 12 }}>
          <span>
            total <b className="mono">{timings.totalMs} ms</b>
          </span>
          <span>·</span>
          <span>
            embeddings <b className="mono">{embedding.model}</b> ({embedding.quantisation}, {embedding.dims}d, local)
          </span>
          <span>·</span>
          <span>
            store <b className="mono">{store.engine}</b>, {store.metric} metric
          </span>
        </div>
      </Panel>

      <Panel
        title="What the settings produced"
        sub={
          effective.chunkSize !== ingest.params.requested.chunkSize || effective.overlap !== ingest.params.requested.overlap
            ? `requested ${ingest.params.requested.chunkSize}/${ingest.params.requested.overlap}, clamped to ${effective.chunkSize}/${effective.overlap}`
            : `chunk size ${effective.chunkSize}, overlap ${effective.overlap}`
        }
      >
        <div className="figs">
          <Fig k="Chunks" v={stats.count} />
          <Fig k="Avg size" v={stats.avgChars} sub="chars" />
          <Fig k="Smallest" v={stats.minChars} sub="chars" />
          <Fig k="Largest" v={stats.maxChars} sub="chars" />
          <Fig k="Tokens" v={stats.tokensEst.toLocaleString()} sub="est." />
          <Fig k="Duplicated" v={`${duplication.toFixed(1)}%`} sub="by overlap" />
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="row tiny muted" style={{ marginBottom: 7 }}>
            <b className="grow" style={{ color: 'var(--ink)' }}>The document, to scale</b>
            <span>{docChars.toLocaleString()} characters</span>
          </div>
          <DocumentMap
            chunks={chunks}
            docChars={docChars}
            pageSpans={pageSpans}
            selected={selected}
            onSelect={setSelected}
          />
        </div>

        <div style={{ marginTop: 16 }}>
          <Fold summary={`Where each chunk was cut — ${Object.entries(stats.cutReasons).map(([k, v]) => `${v} on ${k}`).join(', ')}`}>
            <p className="tiny muted" style={{ marginTop: 0 }}>
              The chunker aims for the size you set, then looks backwards for the best boundary it can
              reach — a paragraph break beats a bullet, a bullet beats a line, a line beats a sentence
              end. A chunk cut on <span className="mono">word space</span> means no better boundary was
              within reach; many of those is a sign the document has little structure left after
              extraction.
            </p>
            <table className="grid">
              <thead>
                <tr><th>Boundary</th><th style={{ textAlign: 'right' }}>Chunks</th><th>Share</th></tr>
              </thead>
              <tbody>
                {Object.entries(stats.cutReasons)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, n]) => (
                    <tr key={reason}>
                      <td className="mono">{reason}</td>
                      <td className="num">{n}</td>
                      <td>
                        <span className="bar" style={{ maxWidth: 160 }}>
                          <i style={{ width: `${(n / stats.count) * 100}%` }} />
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Fold>

          <Fold summary={`Per-page extraction report — ${numPages} pages, ${rawChars.toLocaleString()} raw chars in`}>
            <p className="tiny muted" style={{ marginTop: 0 }}>
              A PDF stores glyph runs at coordinates, not lines of text. Lines are rebuilt from those
              coordinates, then ligature splits (<span className="mono">"fi eld"</span>) and flattened
              footnote markers are repaired. Newlines are kept deliberately — they are the chunker's
              best cut points.
            </p>
            <div className="scrollx">
              <table className="grid">
                <thead>
                  <tr><th>Page</th><th style={{ textAlign: 'right' }}>Glyph runs</th><th style={{ textAlign: 'right' }}>Lines</th><th style={{ textAlign: 'right' }}>Chars</th><th>Repairs applied</th></tr>
                </thead>
                <tbody>
                  {pageReports.map((p) => (
                    <tr key={p.page}>
                      <td className="mono">p{p.page}</td>
                      <td className="num">{p.runs}</td>
                      <td className="num">{p.lines}</td>
                      <td className="num">{p.cleanChars}</td>
                      <td className="tiny muted">{p.edits.map((e) => e.detail).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
        </div>
      </Panel>

      <Panel
        title={`The chunks themselves — ${stats.count}`}
        sub="highlighted text is overlap: the same characters live in the neighbouring chunk too"
        right={
          chunks.length > 12 ? (
            <button className="btn ghost sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show first 12' : `Show all ${chunks.length}`}
            </button>
          ) : null
        }
      >
        {pinned ? (
          <div style={{ marginBottom: 14 }}>
            <Note kind="info">
              Pinned <b>chunk {pinned.index}</b> from the map — characters {pinned.charStart.toLocaleString()}–
              {pinned.charEnd.toLocaleString()}, page {pinned.pages.join(', ')}, cut on {pinned.cutOn}.{' '}
              <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setSelected(null)}>
                unpin
              </button>
            </Note>
          </div>
        ) : null}

        <div className="chunks">
          {(pinned ? [pinned, ...visible.filter((c) => c.index !== pinned.index)] : visible).map((c) => (
            <article key={c.id} className={`chunk${c.index === selected ? ' flag' : ''}`}>
              <div className="chunk-top">
                <span className="chunk-id">chunk {c.index}</span>
                <span className="tag cy">p{c.pages.join(', ')}</span>
                <span className="tag">{c.chars} chars</span>
                <span className="tag">~{c.tokensEst} tok</span>
                <span className="tag pk" title="the boundary the chunker cut on">{c.cutOn}</span>
              </div>
              <ChunkText chunk={c} />
              <div className="chunk-foot">
                <span title="characters shared with the previous chunk">← {c.overlapPrev} shared</span>
                <span title="characters shared with the next chunk">{c.overlapNext} shared →</span>
                <span className="grow" />
                <Spark values={c.vectorPreview} height={18} />
                <span className="mono" title="L2 norm — 1.0 means the vector is normalised, so cosine is a plain dot product">
                  ‖v‖={c.vectorNorm}
                </span>
              </div>
            </article>
          ))}
        </div>

        {!showAll && chunks.length > 12 ? (
          <p className="tiny muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Showing 12 of {chunks.length}.
          </p>
        ) : null}
      </Panel>
    </>
  );
}
