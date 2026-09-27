import { useCallback, useEffect, useMemo, useState } from 'react';
import { Note, Panel, Slider } from './components/bits.jsx';
import Logo from './components/Logo.jsx';
import IngestTab from './components/IngestTab.jsx';
import SearchTab from './components/SearchTab.jsx';
import ChatTab from './components/ChatTab.jsx';

async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const TABS = [
  ['ingest', 'Ingest', 'PDF → chunks → vectors'],
  ['search', 'Search', 'question → top chunks'],
  ['chat', 'Chat', 'chunks → grounded answer'],
];

export default function App() {
  const [status, setStatus] = useState(null);
  const [tab, setTab] = useState('ingest');
  const [theme, setTheme] = useState('dark');

  // Dark is the design's home; light is a courtesy for bright rooms and
  // projectors. The attribute is what styles.css keys the light palette off.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The two settings this whole app exists to let people play with.
  const [chunkSize, setChunkSize] = useState(350);
  const [overlap, setOverlap] = useState(60);
  const [topK, setTopK] = useState(3);

  const [ingest, setIngest] = useState(null);
  const [applied, setApplied] = useState(null); // settings the current index was built with
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState(null);

  const [search, setSearch] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState(null);
  const [lastQuery, setLastQuery] = useState(null);

  const [chat, setChat] = useState(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState(null);

  useEffect(() => {
    api('status')
      .then((s) => {
        setStatus(s);
        setChunkSize(s.defaults.chunkSize);
        setOverlap(s.defaults.overlap);
        setTopK(s.defaults.topK);
      })
      .catch((e) => setFatal(`Cannot reach the API: ${e.message}. Is \`npm run server\` running?`));
  }, []);

  // Overlap above half the chunk size duplicates more than it indexes, so the
  // slider's ceiling follows the chunk size rather than letting you get there.
  const maxOverlap = Math.floor(chunkSize / 2);
  useEffect(() => {
    if (overlap > maxOverlap) setOverlap(maxOverlap);
  }, [maxOverlap, overlap]);

  const runIngest = useCallback(async () => {
    setBusy(true);
    setFatal(null);
    try {
      const out = await api('ingest', { chunkSize, overlap });
      setIngest(out);
      setApplied({ chunkSize: out.effective.chunkSize, overlap: out.effective.overlap });
      // The old results were computed against chunks that no longer exist.
      setSearch(null);
      setChat(null);
      setStatus((s) => (s ? { ...s, pipeline: { ...s.pipeline, embedding: out.embedding } } : s));
    } catch (e) {
      setFatal(e.message);
    } finally {
      setBusy(false);
    }
  }, [chunkSize, overlap]);

  // Index once on load so the app is never showing an empty shell.
  useEffect(() => {
    if (status && !ingest && !busy && !fatal) runIngest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const doSearch = useCallback(
    async (query) => {
      setSearchBusy(true);
      setSearchErr(null);
      setLastQuery(query);
      try {
        setSearch(await api('search', { query, topK }));
      } catch (e) {
        setSearchErr(e.message);
        setSearch(null);
      } finally {
        setSearchBusy(false);
      }
    },
    [topK],
  );

  const doAsk = useCallback(
    async (query) => {
      setChatBusy(true);
      setChatErr(null);
      try {
        setChat(await api('chat', { query, topK }));
      } catch (e) {
        setChatErr(e.message);
        setChat(null);
      } finally {
        setChatBusy(false);
      }
    },
    [topK],
  );

  // Re-run the last search when top-K changes — the ranking is unchanged, but
  // where the cut falls is the whole point of that slider.
  const onTopK = (k) => {
    setTopK(k);
    if (lastQuery && tab === 'search') setTimeout(() => doSearch(lastQuery), 0);
  };

  const dirty = useMemo(
    () => applied && (applied.chunkSize !== chunkSize || applied.overlap !== overlap),
    [applied, chunkSize, overlap],
  );

  const pipe = status?.pipeline;
  const doc = status?.data?.pdfs?.[0];

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <Logo size={48} />
          <div className="wordmark">
            <h1>RAG Explorer</h1>
            <p>
              One PDF, taken apart. Watch it become chunks, watch the chunks become vectors, then
              watch a question pick three of them out and an answer get built from only those.
            </p>
          </div>
        </div>
        <div className="rail">
          {pipe ? (
            <>
              <span className="chip">
                <i className="led" /> embed <b>nomic-v1.5</b> {pipe.embedding.dims}d · local
              </span>
              <span className="chip cy">
                <i className="led" /> store <b>LanceDB</b> · embedded
              </span>
              <span className={`chip ${pipe.llm.keyPresent ? 'ok' : 'no'}`}>
                <i className="led" /> llm <b>{pipe.llm.model.replace('openai/', '')}</b> ·{' '}
                {pipe.llm.keyPresent ? 'Groq live' : 'no key'}
              </span>
            </>
          ) : (
            <span className="chip">
              <i className="led" /> connecting…
            </span>
          )}
          <button
            className="icon-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            aria-label="Toggle colour theme"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      {doc ? (
        <div className="docline">
          <span className="pill">{doc}</span>
          <span>
            stays on this machine — only the retrieved excerpts travel, in the Groq prompt on the Chat
            tab
          </span>
        </div>
      ) : null}

      {fatal ? (
        <div style={{ marginTop: 16 }}>
          <Note kind="warn">{fatal}</Note>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Panel
          title="The two settings that decide everything"
          sub="move a slider, press re-ingest, and watch the ranking on the Search tab change"
          right={
            <div className="row">
              {dirty ? (
                <span className="dirty">
                  <i className="dot" /> settings changed — re-ingest to apply
                </span>
              ) : applied ? (
                <span className="tiny muted">
                  index built with {applied.chunkSize}/{applied.overlap}
                </span>
              ) : null}
              <button className="btn" onClick={runIngest} disabled={busy}>
                {busy ? <><span className="spin" /> Ingesting</> : 'Re-ingest'}
              </button>
            </div>
          }
        >
          <div className="controls">
            <Slider
              label="Chunk size"
              value={chunkSize}
              min={150}
              max={1200}
              step={10}
              unit="chars"
              disabled={busy}
              onChange={setChunkSize}
              onCommit={runIngest}
              hint="Bigger chunks carry more context but blur the signal — one chunk covering four topics matches every question weakly. Smaller chunks rank sharply but can cut an answer in half. Try 220, then 900, and compare the same question."
            />
            <Slider
              label="Overlap"
              value={overlap}
              min={0}
              max={maxOverlap}
              step={10}
              unit="chars"
              disabled={busy}
              onChange={setOverlap}
              onCommit={runIngest}
              hint={`Characters each chunk repeats from the one before, so a sentence split by a boundary still survives whole somewhere. Capped at half the chunk size (${maxOverlap}) — past that you are mostly indexing the same text twice.`}
            />
            <Slider
              label="Chunks retrieved (top-K)"
              value={topK}
              min={1}
              max={8}
              step={1}
              disabled={busy}
              onChange={onTopK}
              hint="How many chunks get pasted into the prompt. No re-ingest needed — it only moves where the cut falls. More context is not free: it costs tokens and it dilutes, giving the model more chances to cite the wrong thing."
            />
          </div>
        </Panel>
      </div>

      <nav className="tabs" role="tablist">
        {TABS.map(([id, label, sub], i) => (
          <button
            key={id}
            className="tab"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            title={sub}
          >
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'ingest' ? <IngestTab ingest={ingest} busy={busy} /> : null}
      {tab === 'search' ? (
        <SearchTab
          ingested={Boolean(ingest)}
          topK={topK}
          onSearch={doSearch}
          result={search}
          busy={searchBusy}
          error={searchErr}
        />
      ) : null}
      {tab === 'chat' ? (
        <ChatTab
          ingested={Boolean(ingest)}
          topK={topK}
          keyPresent={Boolean(pipe?.llm?.keyPresent)}
          onAsk={doAsk}
          result={chat}
          busy={chatBusy}
          error={chatErr}
        />
      ) : null}
    </div>
  );
}
