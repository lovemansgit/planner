// Day 19 / PR-B Lane 4 — FAILED status icon.
//
// Hairline-stroke triangle + exclamation. Single-tone red per PR-B
// brief enumeration ("triangle with hairline stroke in red, refined
// — NOT alarmist"). Single-tone exception to the two-tone language:
// a caution glyph is conceptually one thing, no body+accent split.
//
// Rendered inside FAILED pill (bg-red/15 text-red) — red icon on
// red-tinted bg is the design intent (cohesive monochrome at 12px),
// not high-contrast alarm. Skill principle: "context-specific
// character, refined." Refined = subtle, not loud.

interface CautionIconProps {
  /** Pixel size for both width + height (square viewBox). Default 12. */
  readonly size?: number;
}

export function CautionIcon({ size = 12 }: CautionIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
    >
      {/* Triangle outline. */}
      <path
        d="M 12 4 L 22 20 L 2 20 Z"
        stroke="var(--color-red)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Exclamation vertical bar. */}
      <line
        x1={12}
        y1={10}
        x2={12}
        y2={14.5}
        stroke="var(--color-red)"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Exclamation dot — single filled circle, exception to line-only
          language because tiny rings antialias to invisibility at 12px. */}
      <circle cx={12} cy={17.5} r={0.8} fill="var(--color-red)" />
    </svg>
  );
}
