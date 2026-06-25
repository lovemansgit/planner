// Phase 9 Step 3.1 (Foundations) — page-shell recipe (Gap E / D3).
// Phase 12 Batch A (Adoption) — this is now the live single source: the nav
// headers AND every content page body source their width here, so the left
// edge of the nav/logo and the page content share one vertical line on every
// surface. Previously each page hard-coded its own max-w-4xl/5xl/6xl, which is
// why the header↔body misalignment kept recurring per-page.
//
// One content max-width + horizontal padding for every page, and the
// two-column field grid (D3) for detail pages. Class strings live here
// (node-testable) so the single width can't drift.
//
// Width: max-w-6xl (72rem / 1152px) — the width the nav headers already sat at,
// so adopting it moves no nav and no already-correct page; the narrower 4xl/5xl
// bodies widen onto it and their left edge snaps to the nav's.
// Padding: px-6 md:px-12 — desktop (md+) is 48px, pixel-identical to the
// long-standing px-12 gutter on every page and the nav; mobile relaxes to 24px.

/** The shared page content shell: centered, one max-width, consistent padding. */
export function shellClass(className = ""): string {
  return ["mx-auto w-full max-w-6xl px-6 md:px-12", className].filter(Boolean).join(" ");
}

/**
 * D3 detail layout: fill the width as two columns at md+ instead of stranding a
 * narrow left column. Detail pages adopt this in bundle 3.5 — not here.
 */
export function detailGridClass(className = ""): string {
  return ["grid grid-cols-1 gap-x-16 gap-y-6 md:grid-cols-2", className].filter(Boolean).join(" ");
}

/**
 * Phase 12.2 Batch B / Item 6 — table-region right-bleed.
 *
 * Wide admin LIST tables (Subscriptions / Users / Tasks) overflow the shared
 * `shellClass` cap (max-w-6xl, 1056px inner) and scroll horizontally, even
 * though there is unused gutter outside the cap (~128px at 1280, ~288px at
 * 1440). This wraps ONLY the table region: it keeps the shared LEFT edge that
 * Phase 12 Batch A established (the header/filters stay in `shellClass`) and
 * extends the table's RIGHT edge into that otherwise-unused right gutter so more
 * columns show before the in-card horizontal scroll engages.
 *
 * Stepped at xl/2xl with fixed bleeds chosen to stay WITHIN the available
 * gutter at each breakpoint's minimum width (no viewport overflow, no page
 * horizontal scrollbar); zero below xl, so tablet/mobile keep the in-card
 * scroll unchanged. Table-SCOPED on purpose: `shellClass` itself is untouched,
 * so forms, detail views, and every non-table page are unaffected (the Item-6
 * floor — the widen must not be global).
 */
export function tableBleedClass(className = ""): string {
  return ["xl:-mr-24 2xl:-mr-40", className].filter(Boolean).join(" ");
}
