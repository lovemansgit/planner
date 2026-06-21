// D56 Phase 8 / Lane 3 — OUT_FOR_DELIVERY status icon.
//
// Destination map-pin (the last mile, heading to the door) — distinct from
// the VanIcon (assigned) and TruckIcon (in-transit). Single-tone navy: this
// glyph renders on the solid hi-vis Signal Amber pill (`bg-amber`, Love-
// locked as the highest-attention state), where navy reads at high contrast.

interface OutForDeliveryIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function OutForDeliveryIcon({ size = 12 }: OutForDeliveryIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="ofd"
    >
      {/* Map pin — teardrop body. */}
      <path
        d="M 12 21 C 12 21 5 14.5 5 9.5 A 7 7 0 1 1 19 9.5 C 19 14.5 12 21 12 21 Z"
        stroke="var(--color-navy)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Pin centre — filled dot reads at 12px. */}
      <circle cx={12} cy={9.5} r={2.25} fill="var(--color-navy)" />
    </svg>
  );
}
