// Phase 9 Step 3.1 (Foundations) — PageShell + DetailGrid (Gap E / D3).
//
// PageShell is the one content-width container every page sits inside (it
// replaces the audit's ad-hoc max-w-2xl/4xl/6xl/prose sprawl). DetailGrid is
// the D3 two-column field layout detail pages adopt in a later bundle. Both
// wrap the node-tested page-shell-recipe. Additive — no screen is migrated
// onto these here.

import type { ElementType, ReactNode } from "react";

import { detailGridClass, shellClass } from "./page-shell-recipe";

export function PageShell({
  as: Tag = "div",
  className = "",
  children,
}: {
  readonly as?: ElementType;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <Tag className={shellClass(className)}>{children}</Tag>;
}

export function DetailGrid({
  className = "",
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <div className={detailGridClass(className)}>{children}</div>;
}
