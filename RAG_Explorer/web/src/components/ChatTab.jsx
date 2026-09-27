import { useState } from 'react';
import { Fig, Fold, Note, Panel, ScoreBar } from './bits.jsx';

const EXAMPLES = [
  'How fast must the login page load, and what else is required for performance?',
  'Summarise the security requirements.',
  'What accessibility standards does the login page have to meet?',
  'What is planned after Phase 1?',
  'What is the refund policy for enterprise contracts?',
];

/**
 * Render the answer with its citations turned into chips.
 *
 * The model is asked to cite as [chunk 2]; gpt-oss sometimes emits the
 * full-width 【chunk 2】 instead, so both are matched. Markdown bold is honoured
 * because the model uses it and raw ** in the output looks like a bug.
 *
 * The space inside the citation is matched with \s, not a literal space: this
 * model types a narrow no-break space (U+202F) in there. It is invisible in the
 * output and it silently broke every citation until the code points were dumped.
 */
function Answer({ text, onCite }) {
  const parts = text.split(/(\[chunk\s*\d+\]|【chunk\s*\d+】|\*\*[^*]+\*\*)/g);
  return (
    <div className="answer">
      {parts.map((p, i) => {
        const cite = p.match(/^[[【]chunk\s*(\d+)[\]】]$/);
        if (cite) {
          return (
            <span key={i} className="cite" onClick={() => onCite(Number(cite[1]))} title="jump to this chunk">
              chunk {cite[1]}
            </span>
          );
        }
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}

export default function ChatTab({ ingested, topK, keyPresent, onAsk, result, busy, error }) {
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [focus, setFocus] = useState(null);

  const submit = (e) => {
    e?.preventDefault();
    if (query.trim()) onAsk(query.trim());
  };

  if (!ingested) {
    return <div className="empty">Ingest the document first — there is nothing to ground an answer in.</div>;
  }

  const refused = result?.answer?.trim().startsWith('That is not in the retrieved context');

  return (
    <>
      <Panel
        title="Retrieve, augment, generate"
        sub={`the retrieved chunks are pasted into the prompt, then ${result?.model ?? 'gpt-oss-120b'} answers from them`}
      >
        {!keyPresent ? (
          <div style={{ marginBottom: 14 }}>
            <Note kind="warn">
              No <span className="mono">GROQ_API_KEY</span> loaded. Put it in{' '}
              <span className="mono">RAG_Explorer/.env</span> and restart the server. Retrieval works without
              it — only this tab needs the model.
            </Note>
          </div>
        ) : null}

        <form className="searchbar" onSubmit={submit}>
          <input
            type="text"
            value={query}
            placeholder="Ask a question about the document…"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn" type="submit" disabled={busy || !query.trim()}>
            {busy ? <><span className="spin" /> Thinking</> : 'Ask'}
          </button>
        </form>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => { setQuery(ex); onAsk(ex); }} disabled={busy}>
              {ex.length > 52 ? `${ex.slice(0, 50)}…` : ex}
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ marginBottom: 0, marginTop: 12 }}>
          The last example is not in the document. It is there on purpose — a RAG system that cannot
          say "I don't know" is worse than no RAG system, because a confident invention reads exactly
          like a correct answer.
        </p>
        {error ? <div style={{ marginTop: 12 }}><Note kind="warn">{error}</Note></div> : null}
      </Panel>

      {result ? (
        <>
          <Panel
            title="Answer"
            sub={`${result.model} · grounded in ${result.chunks.length} retrieved chunks`}
            right={
              <span className="tiny muted mono">
                {result.timings.embedMs + result.timings.retrieveMs} ms retrieve + {result.timings.generateMs} ms generate
              </span>
            }
          >
            {refused ? (
              <div style={{ marginBottom: 14 }}>
                <Note kind="info">
                  The model refused, which is the correct outcome here. Retrieval still returned{' '}
                  {result.chunks.length} chunks — its best were only{' '}
                  <b className="mono">{result.chunks[0].similarity.toFixed(4)}</b> similar — and the
                  system prompt forbids answering from anything but those. Without that instruction
                  the model would have written a plausible policy from training data instead.
                </Note>
              </div>
            ) : null}

            <Answer text={result.answer} onCite={setFocus} />

            {result.usage ? (
              <div className="figs" style={{ marginTop: 20 }}>
                <Fig k="Prompt" v={result.usage.prompt_tokens} sub="tok" />
                <Fig k="Answer" v={result.usage.completion_tokens} sub="tok" />
                {result.usage.completion_tokens_details?.reasoning_tokens ? (
                  <Fig k="Reasoning" v={result.usage.completion_tokens_details.reasoning_tokens} sub="tok" />
                ) : null}
                <Fig k="Total" v={result.usage.total_tokens} sub="tok" />
                <Fig k="Generate" v={result.timings.generateMs} sub="ms" />
              </div>
            ) : null}
          </Panel>

          <Panel
            title="What was actually sent to the model"
            sub="the whole point of RAG is in this text — the answer above could only come from here"
          >
            <Fold summary={`System prompt — the rules, ${result.prompt.system.length} chars`}>
              <pre className="code">{result.prompt.system}</pre>
            </Fold>
            <Fold summary={`User message — the retrieved context plus the question, ${result.prompt.user.length} chars`}>
              <pre className="code">{result.prompt.user}</pre>
            </Fold>
            <p className="tiny muted" style={{ marginBottom: 0, marginTop: 12 }}>
              Nothing else reached the model — no document, no file, no search tool. It saw{' '}
              {result.prompt.contextChars.toLocaleString()} characters of retrieved text and a
              question. That is why a wrong chunk produces a wrong answer no matter how good the
              model is, and why the sliders above matter more than the model choice.
            </p>
          </Panel>

          <Panel
            title="The chunks it was given"
            sub="in the order they appeared in the prompt, with the weight that earned them the place"
          >
            {result.chunks.map((c, i) => (
              <article
                key={c.id}
                className={`hit${focus === i + 1 ? ' one' : ''}`}
                style={focus === i + 1 ? { outline: '2px solid var(--violet)' } : undefined}
              >
                <div className="hit-top">
                  <span className="rank">{c.label}</span>
                  <span className="tag">chunk {c.index}</span>
                  <span className="tag cy">p{c.pages.join(', ')}</span>
                  <ScoreBar value={c.similarity} />
                </div>
                <div className="chunk-text">{c.text}</div>
              </article>
            ))}
          </Panel>
        </>
      ) : (
        <div className="empty">Ask a question to see the retrieval, the prompt and the answer.</div>
      )}
    </>
  );
}
