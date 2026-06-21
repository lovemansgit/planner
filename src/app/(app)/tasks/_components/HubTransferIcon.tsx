// D56 Phase 8 / Lane 3 — HUB_TRANSFER status icon.
//
// Two hubs exchanging a parcel: two navy nodes with a pair of amber-deep
// arrows running between them (out on top, back on the bottom). Two-tone,
// rendered on the light Amber-deep pill. Distinct from the single-vehicle
// transit glyphs — two nodes + bidirectional arrows reads as "moving
// between depots".

interface HubTransferIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function HubTransferIcon({ size = 12 }: HubTransferIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="hub"
    >
      {/* Two hub nodes. */}
      <circle cx={5.5} cy={12} r={2.5} stroke="var(--color-navy)" strokeWidth={1.5} />
      <circle cx={18.5} cy={12} r={2.5} stroke="var(--color-navy)" strokeWidth={1.5} />
      {/* Top transfer arrow → (left hub to right hub). */}
      <path
        d="M 8.5 8.5 L 15.5 8.5 M 13.5 6.5 L 15.5 8.5 L 13.5 10.5"
        stroke="var(--color-amber-deep)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bottom transfer arrow ← (right hub to left hub). */}
      <path
        d="M 15.5 15.5 L 8.5 15.5 M 10.5 13.5 L 8.5 15.5 L 10.5 17.5"
        stroke="var(--color-amber-deep)"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
