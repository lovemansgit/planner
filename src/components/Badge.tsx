// Day-53 Tier-2 #5 — shared badge/pill shell.
//
// The canonical pill recipe used for status + state badges across the
// operator UI: `inline-flex` chip with consistent padding, uppercase
// caption type, and tracking. The colour treatment is injected via
// `className` (e.g. a per-status `pillClass`) so one shell serves every
// badge while the palette stays per-use. Extracting it stops the
// shell from drifting per page (audit finding 3).
//
// `size` selects between the two real geometries in the UI: `md`
// (default — the /tasks status pill) and `sm` (the compact
// DayActionPopover dialog badges). The class strings live in the
// node-testable ./badge-recipe sibling so each recipe stays locked.

import type { ReactNode } from "react";

import { badgeClass, type BadgeSize } from "./badge-recipe";

export function Badge({
  size = "md",
  className = "",
  children,
}: {
  /** Geometry: `md` (default, /tasks pill) or `sm` (popover dialog badge). */
  readonly size?: BadgeSize;
  /** Colour/treatment classes injected per use (e.g. a status pillClass). */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <span className={badgeClass(size, className)}>{children}</span>;
}
