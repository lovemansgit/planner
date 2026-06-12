// Day-53 Tier-2 #5 — shared badge/pill shell.
//
// The canonical pill recipe used for status + state badges across the
// operator UI: `inline-flex` chip with consistent padding, uppercase
// caption type, and tracking. The colour treatment is injected via
// `className` (e.g. a per-status `pillClass`) so one shell serves every
// badge while the palette stays per-use. Extracting it stops the
// shell from drifting per page (audit finding 3).

import type { ReactNode } from "react";

export function Badge({
  className = "",
  children,
}: {
  /** Colour/treatment classes injected per use (e.g. a status pillClass). */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.1em] ${className}`}
    >
      {children}
    </span>
  );
}
