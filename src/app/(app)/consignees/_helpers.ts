// Day-22 §3.22 fixup — consignees list helpers.
//
// Pure helper for the client-side search filter on /consignees. Lives
// outside `_components/` so unit tests don't pull the "use client"
// boundary into the test graph. Pattern mirrors
// src/app/(admin)/admin/merchants/_helpers.ts.

import type { Consignee } from "@/modules/consignees";

/**
 * Filter consignees by a free-text query against name + phone.
 *
 *   - Empty / whitespace-only query returns the full list (no filter).
 *   - Case-insensitive substring match on `name` (operator-typed).
 *   - Substring match on `phone` after stripping non-digit characters
 *     so operators can paste either E.164 (`+971501234567`) or local
 *     format (`050 123 4567` → `0501234567`) and find the row.
 *
 * Pure helper; exported for unit-test coverage.
 *
 * v1 client-side filter scope per PR #238 §3.22: works against the
 * server-rendered list (full tenant, currently capped by listConsignees
 * — pilot tenants have <100 rows). If row counts grow past ~1000,
 * defer to server-side search in Phase 2.
 */
export function filterConsigneesByQuery(
  rows: readonly Consignee[],
  query: string,
): readonly Consignee[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return rows;
  const needle = trimmed.toLowerCase();
  const phoneNeedle = trimmed.replace(/\D/g, "");
  return rows.filter((c) => {
    if (c.name.toLowerCase().includes(needle)) return true;
    if (phoneNeedle.length > 0) {
      const phoneDigits = c.phone.replace(/\D/g, "");
      if (phoneDigits.includes(phoneNeedle)) return true;
    }
    return false;
  });
}
