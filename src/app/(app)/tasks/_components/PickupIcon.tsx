// D56 Phase 8 / Lane 3 — PICKED_UP status icon.
//
// Parcel lifted off the ground: a navy box with an amber-deep arrow rising
// out of it ("collected by the courier"). Two-tone per the TruckIcon idiom
// (navy body + amber accent), rendered on the light Amber-100 pill. Distinct
// from PackageIcon (static box, tape cross) — the rising arrow carries the
// "picked up" motion.

interface PickupIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function PickupIcon({ size = 12 }: PickupIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="pickup"
    >
      {/* Parcel box — lower half. */}
      <rect
        x={6}
        y={13}
        width={12}
        height={7}
        rx={1}
        stroke="var(--color-navy)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Lift arrow — rising out of the box, amber-deep accent. */}
      <line
        x1={12}
        y1={12}
        x2={12}
        y2={4}
        stroke="var(--color-amber-deep)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path
        d="M 8.5 7.5 L 12 4 L 15.5 7.5"
        stroke="var(--color-amber-deep)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
