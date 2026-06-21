// D56 Phase 8 / Lane 3 — REATTEMPT status icon.
//
// Circular retry arrow ("delivery will be re-attempted"). Single-tone
// Stone-600 — the hold family (rendered on the Ivory pill), matching the
// §3.3.11 ON_HOLD token. Distinct from RescheduleIcon (calendar): the loop
// arrow carries the "try again" meaning.

interface RetryIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function RetryIcon({ size = 12 }: RetryIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="retry"
    >
      {/* Open loop — ~270° arc, top-right gap for the arrowhead. */}
      <path
        d="M 18.5 8 A 7 7 0 1 0 19 12"
        stroke="var(--color-stone-600)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrowhead closing the loop at the top. */}
      <path
        d="M 15.5 7.5 L 18.5 8 L 18.5 11"
        stroke="var(--color-stone-600)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
