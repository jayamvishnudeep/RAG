import { useState } from 'react';
import { Fig, Fold, Note, Panel, ScoreBar, Spark } from './bits.jsx';

const EXAMPLES = [
  'How fast must the login page load?',
  'What are the accessibility requirements?',
  'Is biometric authentication planned?',
  'What happens in Phase 1 of the rollout?',
  'How are failed login attempts handled?',
  'What is the refund policy for enterprise contracts?',
];

/**
 * Every chunk's score, in rank order, with the top-K cut drawn on it.
 *
 * The top-K list on its own hides the thing worth seeing: whether the winners
 * actually stood out, or whether rank 3 and rank 4 were separated by 0.003 and
 * the cut-off is essentially arbitrary. A flat distribution means the chunks are
 * too big or too alike, and the fix is the chunk-size slider, not a better model.
 */
function Distribution({ ranking, topK, onHover }) {
  if (!ranking?.length) return null;
  const hi = ranking[0].similarity;
  const lo = ranking[ranking.length - 1].similarity;
  const span = Math.max(0.0001, hi - lo);
  // Scale to the actual range, not to 0..1 — cosine scores on real prose live in
  // a narrow band and a 0..1 axis would render every bar the same height.
  const h = (s) => 8 + ((s - lo) / span) * 92;

  return (
    <>
      <div className="dist">
        {ranking.map((r) => (
          <div
            key={r.index}
            className={`col ${r.rank <= topK ? (r.rank === 1 ? 'top' : 'in') : ''}`}
            title={`rank ${r.rank} · chunk ${r.index} · similarity ${r.similarity.toFixed(4)}`}
            onMouseEnter={() => onHover?.(r.index)}
            onMouseLeave={() => onHover?.(null)}
          >
            <i style={{ height: `${h(r.similarity)}%` }} />
          </div>
        ))}
        {/* The cut falls BETWEEN rank K and rank K+1, so it is drawn as a
            vertical divider at that position rather than along the baseline. */}
        {topK < ranking.length ? (
          <div className="cut" style={{ left: `${(topK / ranking.length) * 100}%` }}>
            <span>top-{topK} cut</span>
          </div>
        ) : null}
      </div>
      <div className="row tiny muted" style={{ marginTop: 18 }}>
        <span>best <b className="mono">{hi.toFixed(4)}</b></span>
        <span>·</span>
        <span>worst <b className="mono">{lo.toFixed(4)}</b></span>
        <span>·</span>
        <span>spread <b className="mono">{span.toFixed(4)}</b></span>
        <span className="grow" />
        <span>{ranking.length} chunks scored, bars scaled to this range</span>
      </div>
    </>
  );
}

export default function SearchTab({ ingested, topK, onSearch, result, busy, error }) {
  const [query, setQuery] = useState(EXAMPLES[0]);

  const submit = (e) => {
    e?.preventDefault();
    if (query.trim()) onSearch(query.trim());
  };

  if (!ingested) {
    return <div className="empty">Ingest the document first — there is nothing to search yet.</div>;
  }

  const weak = result && result.hits[0]?.similarity < 0.6;

  return (
    <>
      <Panel title="Ask the index" sub="retrieval only — no language model is involved on this tab">
        <form className="searchbar" onSubmit={submit}>
          <input
            type="text"
            value={query}
            placeholder="Ask something about the document…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || !query.trim()}>
            {busy ? <><span className="spin" /> Searching</> : `Search top ${topK}`}
          </button>
        </form>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQuery(ex); onSearch(ex); }} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
        {error ? <div style={{ marginTop: 12 }}><Note kind="warn">{error}</Note></div> : null}
      </Panel>

      {result ? (
        <>
          <Panel
            title="The question became a vector"
            sub="the same model that embedded the chunks, with a different task prefix"
          >
            <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
              <div style={{ flex: '1 1 300px', minWidth: 260 }}>
                <div className="tiny muted" style={{ marginBottom: 5 }}>sent to the embedding model</div>
                <pre className="code" style={{ maxHeight: 90 }}>{result.embeddedAs}</pre>
                <p className="tiny muted" style={{ marginBottom: 0 }}>
                  Nomic is trained with task prefixes: passages are embedded as{' '}
                  <span className="mono">search_document:</span> and questions as{' '}
                  <span className="mono">search_query:</span>. Drop them and retrieval measurably
                  degrades, because you are comparing two things the model was taught to place in
                  different regions of the space.
                </p>
              </div>
              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <div className="tiny muted" style={{ marginBottom: 5 }}>
                  first 24 of {result.queryVector.dims} dimensions
                </div>
                <Spark values={result.queryVector.preview} height={44} />
                <div className="figs" style={{ marginTop: 12 }}>
                  <Fig k="Dims" v={result.queryVector.dims} />
                  <Fig k="‖v‖" v={result.queryVector.norm} />
                  <Fig k="Embed" v={result.timings.embedMs} sub="ms" />
                  <Fig k="Search" v={result.timings.searchMs} sub="ms" />
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title={`Top ${result.topK} by cosine similarity`}
            sub="the bar is the weight: how close this chunk's vector sits to the question's"
          >
            {weak ? (
              <div style={{ marginBottom: 14 }}>
                <Note kind="warn">
                  Best match is only <b>{result.hits[0].similarity.toFixed(4)}</b>. Below about 0.60
                  the retriever is returning the least-bad chunks rather than relevant ones — usually
                  because the document does not answer this question at all. Retrieval always returns{' '}
                  <i>something</i>; that is why the generation step is told to refuse.
                </Note>
              </div>
            ) : null}

            {result.hits.map((h) => (
              <article key={h.id} className={`hit${h.rank === 1 ? ' one' : ''}`}>
                <div className="hit-top">
                  <span className="rank">#{h.rank}</span>
                  <span className="tag">chunk {h.index}</span>
                  <span className="tag cy">p{h.pages.join(', ')}</span>
                  <span className="tag">{h.chars} chars</span>
                  <ScoreBar value={h.similarity} />
                </div>
                <div className="chunk-text">{h.text}</div>
                <div className="chunk-foot">
                  <span title="what LanceDB returns; cosine similarity is 1 minus this">
                    cosine distance {h.distance.toFixed(4)}
                  </span>
                  <span>·</span>
                  <span>similarity = 1 − distance = {h.similarity.toFixed(4)}</span>
                </div>
              </article>
            ))}
          </Panel>

          <Panel
            title="Every chunk, ranked"
            sub="what the top-K list hides — how close the runners-up were"
          >
            <Distribution ranking={result.ranking} topK={result.topK} />
            <div style={{ marginTop: 16 }}>
              <Fold summary="Why score all of them, when that defeats the point of an index?">
                <p className="tiny muted" style={{ margin: 0 }}>
                  It does defeat the point — and it is only affordable here because the document is
                  small. LanceDB answered the real query with an index; the full ranking beside it is
                  computed separately, by dot-producting the question against all{' '}
                  {result.chunkCount} chunk vectors, purely so this chart can exist. On a million
                  chunks you would never do that, and the approximate-nearest-neighbour index is
                  precisely what you would pay for instead. The two agree on the ordering here, which
                  is the useful thing to notice: the index is not guessing.
                </p>
              </Fold>
            </div>
          </Panel>
        </>
      ) : (
        <div className="empty">Run a search to see the ranking.</div>
      )}
    </>
  );
}
