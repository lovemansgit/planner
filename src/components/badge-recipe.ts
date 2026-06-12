// Shared <Badge> recipe (audit finding 3 — badge-shell drift).
//
// One invariant treatment + two real geometries that exist across the
// operator UI. Keeping the class strings here (node-testable, no JSX)
// lets the badge-recipe.spec lock each recipe against silent re-drift.

export type BadgeSize = "md" | "sm";

// Caption type + layout shared by every badge size.
const INVARIANT = "inline-flex items-center font-medium uppercase tracking-[0.1em]";

// Per-size geometry. `md` is the /tasks status pill (#458) — unchanged so its
// render stays byte-identical. `sm` is the DayActionPopover dialog badge.
const GEOMETRY: Record<BadgeSize, string> = {
  md: "gap-1.5 px-2.5 py-1 text-xs",
  sm: "rounded-sm px-2 py-0.5 text-[10px]",
};

/** Compose the badge shell classes for `size`, appending caller treatment. */
export function badgeClass(size: BadgeSize = "md", className = ""): string {
  return [INVARIANT, GEOMETRY[size], className].filter(Boolean).join(" ");
}
