// Shared <StatusBadge> (Phase 9 · Step 3.3 — Gap B).
//
// One status pill for CRM / subscription / push surfaces. Pass the `domain`
// and the raw `status`; the component owns the label + tone via
// status-badge-recipe, so a status renders one way everywhere. Unknown
// statuses degrade to a neutral, humanised pill — never a crash.
//
// Server-renderable (no interactivity). NOT for task surfaces: the
// status-filter lane owns /tasks + /admin/tasks status rendering.

import { statusLabel } from "@/shared/humanize";

import {
  statusBadgeClass,
  statusMeta,
  type StatusBadgeSize,
  type StatusDomain,
} from "./status-badge-recipe";

interface StatusBadgeProps {
  readonly domain: StatusDomain;
  /** Raw status enum value for the domain (e.g. "active", "HIGH_RISK"). */
  readonly status: string;
  /** "lg" for detail headers; "md" (default) everywhere else. */
  readonly size?: StatusBadgeSize;
  readonly className?: string;
}

export function StatusBadge({ domain, status, size = "md", className = "" }: StatusBadgeProps) {
  const meta = statusMeta(domain, status);
  const label = meta?.label ?? statusLabel(status);
  const tone = meta?.tone ?? "ended";
  return (
    <span className={statusBadgeClass(tone, size, className)} aria-label={`Status: ${label}`}>
      {label}
    </span>
  );
}
