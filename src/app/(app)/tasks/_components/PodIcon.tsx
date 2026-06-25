// Phase 12.2 Batch B / Item 2 — POD proof-of-delivery photo icon.
//
// Previously a custom inline cooler-bag silhouette (navy body + green zipper).
// The owner's authed walk flagged that the small filled-bag glyph reads as a
// padlock/lock at table-cell size and confused users about what the indicator
// means. It is a proof-of-DELIVERY PHOTO affordance — clicking opens the POD
// lightbox — so this swaps to an unambiguous camera glyph from lucide-react
// (the codebase's icon set; see CopyableUrl.tsx for the import convention).
//
// Icon swap only — the prop API (tone + size) is unchanged, so every caller
// (admin /tasks AdminPodCell, operator /tasks PodCell, the calendar POD cards)
// renders identically in size and placement; only the glyph changes.
//
// Tone: active = brand navy ink (POD populated); muted = stone-600 @ 0.4 opacity
// (the NULL / no-photo state), matching the prior treatment.
//
// Sizing: 18px default for the table cell; callers may override.

import { Camera } from "lucide-react";

interface PodIconProps {
  /** "active" = brand ink (POD populated); "muted" = stone (NULL state). */
  readonly tone: "active" | "muted";
  /** Pixel size for both width + height. Default 18. */
  readonly size?: number;
}

export function PodIcon({ tone, size = 18 }: PodIconProps) {
  const color = tone === "active" ? "var(--color-navy)" : "var(--color-stone-600)";
  const opacity = tone === "active" ? 1 : 0.4;
  return (
    <Camera
      width={size}
      height={size}
      color={color}
      strokeWidth={1.75}
      aria-hidden="true"
      style={{ opacity }}
    />
  );
}
