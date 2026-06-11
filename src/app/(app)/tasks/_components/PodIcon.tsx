// Day 19 / A2 plan §6.1 — POD bag-silhouette icon.
//
// Custom inline SVG cooler-bag glyph rendered in brand-canon colors per
// memory/followup_day_18_smoke_surfaced_ui_gaps.md §4 visual treatment
// (navy body + green zipper accent; muted state in stone-600).
//
// Brand tokens reference src/styles/brand-tokens.css — sibling memo
// referenced `--brand-navy` / `--brand-green` which do not exist;
// the actual tokens are `--color-navy` / `--color-green`. PR
// description records this naming-drift correction.
//
// Sizing: 18px default for table cell, callers may override (calendar
// week-card uses the actual photo thumbnail, not the icon — only the
// tasks-page column renders this glyph).

interface PodIconProps {
  /** "active" = brand colors (POD populated); "muted" = stone (NULL state). */
  readonly tone: "active" | "muted";
  /** Pixel size for both width + height (square viewBox). Default 18. */
  readonly size?: number;
}

export function PodIcon({ tone, size = 18 }: PodIconProps) {
  const bodyColor =
    tone === "active" ? "var(--color-navy)" : "var(--color-stone-600)";
  const accentColor =
    tone === "active" ? "var(--color-green)" : "var(--color-stone-600)";
  const opacity = tone === "active" ? 1 : 0.4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-hidden="true"
      style={{ opacity }}
    >
      {/* Handles — two arches over the top opening. */}
      <path
        d="M8 8 V6 a2 2 0 0 1 2-2 h4 a2 2 0 0 1 2 2 V8"
        stroke={bodyColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      {/* Bag body — rounded rectangle. */}
      <rect x={4} y={8} width={16} height={13} rx={1.5} fill={bodyColor} />
      {/* Zipper / piping accent — single horizontal line in green. */}
      <line
        x1={4.75}
        y1={13}
        x2={19.25}
        y2={13}
        stroke={accentColor}
        strokeWidth={1.25}
        strokeLinecap="round"
      />
    </svg>
  );
}
