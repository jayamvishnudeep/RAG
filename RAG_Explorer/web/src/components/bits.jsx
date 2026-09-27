// Small shared pieces. Kept in one file because none of them is big enough to
// justify its own, and the interesting code lives in the three tabs.

/** A labelled number. */
export function Fig({ k, v, sub }) {
  return (
    <div className="fig">
      <div className="k">{k}</div>
      <div className="v">
        {v}
        {sub ? <small> {sub}</small> : null}
      </div>
    </div>
  );
}

/**
 * A slider that shows its value and explains what moving it does.
 * `onCommit` fires on release, not on every pixel — re-ingesting on mousemove
 * would fire dozens of embedding runs.
 */
export function Slider({ label, value, min, max, step = 1, unit, hint, onChange, onCommit, disabled }) {
  // --fill drives the gradient portion of the track; see styles.css.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="control">
      <label>
        <span>{label}</span>
        <b>
          {value}
          {unit ? ` ${unit}` : ''}
        </b>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--fill': `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
      />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/**
 * The first N dimensions of a vector, drawn as signed bars.
 *
 * It is not a chart anyone would read numerically. It is here to make the point
 * that "embedding" means this: the text became a fixed-length list of signed
 * floats, and every comparison from here on is arithmetic on these.
 */
export function Spark({ values, height = 22 }) {
  if (!values || values.length === 0) return null;
  const peak = Math.max(...values.map(Math.abs)) || 1;
  return (
    <div className="spark" style={{ height }} title={`first ${values.length} of 768 dimensions`}>
      {values.map((v, i) => (
        <i
          key={i}
          className={v < 0 ? 'neg' : ''}
          style={{ height: `${Math.max(8, (Math.abs(v) / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** A 0..1 score as a bar plus the number. */
export function ScoreBar({ value, max = 1 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <>
      <span className="bar">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="score">{value.toFixed(4)}</span>
    </>
  );
}

/** A pipeline stage card. `where` marks whether the work left the machine. */
export function Stage({ n, title, value, ms, where = 'local' }) {
  return (
    <div className={`stage ${where}`}>
      <div className="n">{n}</div>
      <div className="t">{title}</div>
      <div className="v">{value}</div>
      {ms !== undefined && ms !== null ? <div className="ms">{ms} ms</div> : null}
    </div>
  );
}

export function Note({ kind = 'info', children }) {
  return <div className={`note ${kind}`}>{children}</div>;
}

export function Panel({ title, sub, right, children }) {
  return (
    <section className="panel">
      {(title || right) && (
        <div className="panel-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {sub ? <div className="sub">{sub}</div> : null}
          </div>
          {right}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Fold({ summary, children, open = false }) {
  return (
    <details className="fold" open={open}>
      <summary>{summary}</summary>
      <div className="inner">{children}</div>
    </details>
  );
}
