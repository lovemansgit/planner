// Day 19 / PR-B Lane 4 — ASSIGNED status icon.
//
// Compact delivery-van silhouette — rounded-rectangle body, smaller
// height than TruckIcon to differentiate at 12px. Single-tone navy
// per PR-B brief enumeration ("navy body" — no accent specified).
//
// Differentiation from TruckIcon: van is a uniform-height rectangle
// with rounded corners (rx=1); truck has angled cab+cargo with
// vertical seam. At 12px this reads as "smaller / rounder vehicle
// vs. larger / boxier vehicle" — the silhouette diff carries semantic.

interface VanIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function VanIcon({ size = 12 }: VanIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      {/* Van body — rounded rectangle, lower-height than truck. */}
      <rect
        x={4}
        y={10}
        width={16}
        height={6.5}
        rx={1}
        stroke="var(--color-navy)"
        strokeWidth={1.5}
      />
      {/* Side window divider — horizontal hairline at upper third. */}
      <line
        x1={4.5}
        y1={12}
        x2={19.5}
        y2={12}
        stroke="var(--color-navy)"
        strokeWidth={1}
      />
      {/* Wheels. */}
      <circle cx={7} cy={18.5} r={1.5} stroke="var(--color-navy)" strokeWidth={1.25} />
      <circle cx={17} cy={18.5} r={1.5} stroke="var(--color-navy)" strokeWidth={1.25} />
    </svg>
  );
}
