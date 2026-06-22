// Phase 9 Step 3.1 (Foundations) — page-shell recipe (Gap E / D3).
//
// One content max-width + horizontal padding for every page, and the
// two-column field grid (D3) for detail pages. Class strings live here
// (node-testable) so the single width can't drift. 75rem (~1200px) is the one
// shared width the audit's stranded ~560px / random ~900px / full-bleed pages
// collapse onto (exact value confirmable in Step 3 — locked here as the single
// source). Additive: defining these does not restyle any screen.

/** The shared page content shell: centered, one max-width, consistent padding. */
export function shellClass(className = ""): string {
  return ["mx-auto w-full max-w-[75rem] px-6 md:px-8", className].filter(Boolean).join(" ");
}

/**
 * D3 detail layout: fill the width as two columns at md+ instead of stranding a
 * narrow left column. Detail pages adopt this in bundle 3.5 — not here.
 */
export function detailGridClass(className = ""): string {
  return ["grid grid-cols-1 gap-x-16 gap-y-6 md:grid-cols-2", className].filter(Boolean).join(" ");
}
