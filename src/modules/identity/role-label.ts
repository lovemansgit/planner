// Phase 9 Step 3.1 (Foundations) — role slug → human label (Gap J / D4).
//
// Reuses the frozen ROLES catalogue's `name` field as the single source of
// truth, so "cs-agent" → "CS Agent" and "transcorp-systems" → "Transcorp
// Systems Team" stay correct (a generic humaniser would mangle them to "Cs
// Agent" / "Transcorp Systems"). Unknown slugs fall back to a humanised slug.
// Additive: building this does not restyle any screen.

import { toTitleCase } from "@/shared/humanize";

import { ROLES } from "./roles";

export function roleLabel(slug: string): string {
  for (const role of Object.values(ROLES)) {
    if (role.slug === slug) return role.name;
  }
  return toTitleCase(slug);
}
