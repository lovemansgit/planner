// Day 19 / PR-B Lane 4 — IN_TRANSIT status icon.
//
// Truck side-profile silhouette. Two-tone per PR-B brief: navy body
// stroke + amber cab/cargo divider accent. Stroke language matches
// PodIcon precedent (viewBox 24, stroke 1.5 primary + 1.25 accent).
//
// Path detail simplified for 12px target (status-pill prefix); no
// fine cab-window or door-handle detail that would disappear at small
// sizes per skill principle "12px target, paths optimized for it."
//
// Wheels rendered fill="none" — they sit below body, no overlap to
// punch through. Matches DayActionPopover's hairline geometry.

interface TruckIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function TruckIcon({ size = 12 }: TruckIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      {/* Truck silhouette: cab on left (lower roof) + cargo on right (taller). */}
      <path
        d="M 3 16.5 L 3 11 L 6 11 L 8 9 L 12 9 L 12 7 L 21 7 L 21 16.5 Z"
        stroke="var(--color-navy)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Cab/cargo divider — amber accent inside silhouette. */}
      <line
        x1={12}
        y1={9}
        x2={12}
        y2={16.5}
        stroke="var(--color-amber)"
        strokeWidth={1.25}
      />
      {/* Wheels. */}
      <circle cx={7} cy={18.5} r={1.5} stroke="var(--color-navy)" strokeWidth={1.25} />
      <circle cx={17} cy={18.5} r={1.5} stroke="var(--color-navy)" strokeWidth={1.25} />
    </svg>
  );
}
