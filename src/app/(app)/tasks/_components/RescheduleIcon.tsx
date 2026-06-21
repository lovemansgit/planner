// D56 Phase 8 / Lane 3 — RESCHEDULED status icon.
//
// Calendar with a forward-move arrow ("delivery moved to a new date").
// Single-tone Stone-600 — the hold family (rendered on the Ivory pill),
// matching the §3.3.11 ON_HOLD token. Distinct from RetryIcon (a pure loop
// arrow): the calendar carries the "date changed" meaning.

interface RescheduleIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function RescheduleIcon({ size = 12 }: RescheduleIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="reschedule"
    >
      {/* Calendar body. */}
      <rect
        x={4}
        y={6}
        width={16}
        height={14}
        rx={1}
        stroke="var(--color-stone-600)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Binding posts. */}
      <line x1={8} y1={4} x2={8} y2={7.5} stroke="var(--color-stone-600)" strokeWidth={1.25} strokeLinecap="round" />
      <line x1={16} y1={4} x2={16} y2={7.5} stroke="var(--color-stone-600)" strokeWidth={1.25} strokeLinecap="round" />
      {/* Header divider. */}
      <line x1={4} y1={10} x2={20} y2={10} stroke="var(--color-stone-600)" strokeWidth={1.25} />
      {/* Move-forward arrow inside the body. */}
      <path
        d="M 9 15 L 14.5 15 M 12.5 13 L 14.5 15 L 12.5 17"
        stroke="var(--color-stone-600)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
