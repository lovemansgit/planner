// Shared B+ table chrome for the asset-report surfaces (Phase 10 · Functional
// Surfaces).
//
// The inventory tables are hand-rolled <table>s because their rows EXPAND
// (consignee → date, merchant → consignee) and the shared <DataTable> is a
// presentation-only primitive with no expandable-row API. So instead of
// adopting DataTable they reuse its floating-card recipe here — same warm-white
// card, soft navy depth, uppercase-eyebrow headers, hairline row rules — and
// keep their own row structure. One source of truth for the cell/header/row
// classes the four report files (InventoryView, ConsigneeRows, MerchantRows,
// ReportCells) previously each re-declared by hand.

import { TABLE, TABLE_CARD, TABLE_SCROLL, thClass } from "@/components/data-table-recipe";

export { TABLE, TABLE_CARD, TABLE_SCROLL };

// Header eyebrow — reuse the DataTable header recipe (comfortable density,
// left-aligned: every report header reads left like the data beneath it).
export const REPORT_TH = thClass("comfortable");

// Body cell — B+ ink on the card, tabular figures. No truncation / fixed height
// (unlike DataTable's tdClass) so the expand-button cell and the indented date
// subrows keep their natural geometry.
export const REPORT_TD =
  "px-4 py-3 align-middle text-sm text-[color:var(--color-ink)] tabular-nums";

// Summary (top-level) row — hairline divider + hover, matching DataTable rows.
export const REPORT_ROW =
  "border-b border-[color:var(--color-border-default)] transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[rgba(37,45,96,0.025)]";

// Expanded (nested) subrow — a faint inset tint so it reads as nested under its
// summary row; no hover (it isn't itself a toggle target).
export const REPORT_SUBROW =
  "border-b border-[color:var(--color-border-default)] bg-[rgba(37,45,96,0.025)] last:border-b-0";

// Empty-state panel — the same floating card surface, so "no data" still reads
// as a deliberate B+ surface rather than a bare bordered box.
export const REPORT_EMPTY =
  "rounded-2xl bg-[color:var(--color-b-card)] px-6 py-10 text-sm text-[color:var(--color-text-secondary)] shadow-[var(--shadow-b-card)]";
