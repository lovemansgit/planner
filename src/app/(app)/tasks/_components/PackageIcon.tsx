// Day 19 / PR-B Lane 4 — CREATED status + AWB-empty placeholder icon.
//
// Box outline with cross-tape detail. Single-tone tertiary per PR-B
// brief ("in tertiary tone"); single-tone exception to the two-tone
// language because CREATED is the neutral starting state — no
// special accent semantically warranted.
//
// Variants:
//   - solid (default): CREATED pill prefix, used in status-pill prefix
//   - dashed: AWB-missing placeholder ("—" cell), used in table cells
//     where the AWB column is empty. Dashed-stroke reinforces the
//     "no parcel routed yet" cue without alarmist red.

interface PackageIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
  /** Solid (CREATED) or dashed (AWB-empty placeholder). Default solid. */
  readonly variant?: "solid" | "dashed";
}

export function PackageIcon({ size = 12, variant = "solid" }: PackageIconProps) {
  const dashArray = variant === "dashed" ? "2 2" : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      {/* Box outline. */}
      <rect
        x={4}
        y={7}
        width={16}
        height={12}
        rx={1}
        stroke="var(--color-text-tertiary)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeDasharray={dashArray}
      />
      {/* Horizontal "tape" — across full box width at upper third. */}
      <line
        x1={4}
        y1={11}
        x2={20}
        y2={11}
        stroke="var(--color-text-tertiary)"
        strokeWidth={1.25}
        strokeDasharray={dashArray}
      />
      {/* Vertical "tape" — top half only (tape-cross effect). */}
      <line
        x1={12}
        y1={7}
        x2={12}
        y2={11}
        stroke="var(--color-text-tertiary)"
        strokeWidth={1.25}
        strokeDasharray={dashArray}
      />
    </svg>
  );
}
