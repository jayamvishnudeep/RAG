/**
 * The RAG Explorer mark.
 *
 * Three stacked bars — a document cut into chunks — with one of them lit and
 * ringed: the chunk a query just found. That is the whole product in one glyph,
 * and it stays legible down to 16px because it is only four shapes.
 *
 * `id` has to be unique per instance: SVG gradient ids are document-global, so
 * two logos on one page would otherwise fight over the same definition.
 */
export default function Logo({ size = 40, id = 'ragmark' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="RAG Explorer"
      className="logo"
    >
      <defs>
        <linearGradient id={`${id}-tile`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id={`${id}-hit`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>

      {/* the tile */}
      <rect width="48" height="48" rx="13" fill={`url(#${id}-tile)`} />

      {/* the document, cut into three chunks */}
      <rect x="11" y="13" width="26" height="5" rx="2.5" fill="#fff" opacity="0.92" />
      <rect x="11" y="21.5" width="18" height="5" rx="2.5" fill="#fff" opacity="0.55" />
      <rect x="11" y="30" width="22" height="5" rx="2.5" fill="#fff" opacity="0.4" />

      {/* the chunk the query landed on */}
      <circle cx="34" cy="32.5" r="7.5" fill="none" stroke="#fff" strokeWidth="2.5" opacity="0.25" />
      <circle cx="34" cy="32.5" r="4.5" fill={`url(#${id}-hit)`} />
    </svg>
  );
}
