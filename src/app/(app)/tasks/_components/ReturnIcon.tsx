// D56 Phase 8 / Lane 3 — return status icon (two states, two variants).
//
// A curved "coming back" arrow in the failure-family red. One glyph, two
// variants (cf. PackageIcon solid/dashed):
//   - outline  → PROCESS_FOR_RETURN  (return in progress; open arrowhead)
//   - solid    → RETURNED_TO_SHIPPER (return completed; filled arrowhead)
// Both share the Bright Red failure family; the variant + label disambiguate
// (Love's icon+label-within-a-family ruling).

interface ReturnIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
  /** Outline (in-progress) or solid (completed) arrowhead. Default outline. */
  readonly variant?: "outline" | "solid";
}

export function ReturnIcon({ size = 12, variant = "outline" }: ReturnIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      data-icon="return"
      data-variant={variant}
    >
      {/* Curved shaft — turns right then down (the "return" hook). */}
      <path
        d="M 7 9 H 14 A 4 4 0 0 1 18 13 V 17"
        stroke="var(--color-red)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left-pointing arrowhead at the shaft start. */}
      {variant === "solid" ? (
        <path d="M 7 9 L 11 6 L 11 12 Z" fill="var(--color-red)" />
      ) : (
        <path
          d="M 10.5 5.5 L 7 9 L 10.5 12.5"
          stroke="var(--color-red)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
