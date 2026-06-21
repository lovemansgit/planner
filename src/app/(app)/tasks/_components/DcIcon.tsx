// D56 Phase 8 / Lane 3 — ARRIVED_AT_DC status icon ("Arrived in DC").
//
// Distribution-centre / warehouse silhouette: a navy peaked-roof building
// with an amber-deep roller door. Two-tone (navy body + amber accent),
// rendered on the light Amber-300 pill. Distinct from the vehicle glyphs —
// a building reads as "at the depot, not on a vehicle".

interface DcIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function DcIcon({ size = 12 }: DcIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="dc"
    >
      {/* Building outline — peaked roof + walls. */}
      <path
        d="M 4 20 L 4 11 L 12 6 L 20 11 L 20 20 Z"
        stroke="var(--color-navy)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Roller door — amber-deep accent, centred. */}
      <path
        d="M 9.5 20 L 9.5 14 L 14.5 14 L 14.5 20"
        stroke="var(--color-amber-deep)"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}
