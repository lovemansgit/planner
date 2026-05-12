// Day-22 §3.22 fixup — consignees list filter helper tests.

import { describe, expect, it } from "vitest";

import type { Consignee } from "@/modules/consignees";

import { filterConsigneesByQuery } from "../_helpers";

function row(overrides: Partial<Consignee>): Consignee {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-00000000000a",
    name: "Default Name",
    phone: "+971500000000",
    email: null,
    addressLine: "Default address",
    emirateOrRegion: "Dubai",
    district: "Default District",
    deliveryNotes: null,
    externalRef: null,
    notesInternal: null,
    crmState: "ACTIVE",
    createdAt: "2026-05-11T07:00:00.000Z",
    updatedAt: "2026-05-11T07:00:00.000Z",
    ...overrides,
  };
}

const ROWS: readonly Consignee[] = [
  row({ id: "1", name: "Sarah Khouri", phone: "+971501234567" }),
  row({ id: "2", name: "Fatima Al Mansouri", phone: "+971507654321" }),
  row({ id: "3", name: "Ahmed Hassan", phone: "+971521111111" }),
];

describe("filterConsigneesByQuery", () => {
  it("returns the full list on empty query", () => {
    expect(filterConsigneesByQuery(ROWS, "")).toEqual(ROWS);
  });

  it("returns the full list on whitespace-only query", () => {
    expect(filterConsigneesByQuery(ROWS, "   ")).toEqual(ROWS);
  });

  it("filters by name substring (case-insensitive)", () => {
    expect(filterConsigneesByQuery(ROWS, "sarah").map((r) => r.id)).toEqual(["1"]);
    expect(filterConsigneesByQuery(ROWS, "SARAH").map((r) => r.id)).toEqual(["1"]);
    expect(filterConsigneesByQuery(ROWS, "kHoUrI").map((r) => r.id)).toEqual(["1"]);
  });

  it("filters by partial name (substring match)", () => {
    // "an" matches Mansouri AND Hassan
    expect(filterConsigneesByQuery(ROWS, "an").map((r) => r.id).sort()).toEqual([
      "2",
      "3",
    ]);
  });

  it("filters by E.164 phone substring (digits only)", () => {
    expect(filterConsigneesByQuery(ROWS, "501234567").map((r) => r.id)).toEqual([
      "1",
    ]);
  });

  it("filters by phone with operator-typed formatting (strips non-digits)", () => {
    // Operator pastes "+971 50 765 4321" — should still find Fatima
    // (her phone is +971507654321; the spaces are stripped to digits
    // 971507654321 which matches the stored E.164 digits).
    expect(filterConsigneesByQuery(ROWS, "+971 50 765 4321").map((r) => r.id)).toEqual([
      "2",
    ]);
    // Trailing-digit fragment also works ("4321" matches Fatima)
    expect(filterConsigneesByQuery(ROWS, "76 5432").map((r) => r.id)).toEqual([
      "2",
    ]);
  });

  it("matches across name OR phone (boolean OR)", () => {
    // "5" matches phones (all rows have 5xx mobile prefix) — every row hits
    expect(filterConsigneesByQuery(ROWS, "5").map((r) => r.id).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterConsigneesByQuery(ROWS, "zzznomatch")).toEqual([]);
  });

  it("respects row order from the source array", () => {
    // Reverse-order source, query matches all three — output preserves source order
    const reversed = [...ROWS].reverse();
    expect(filterConsigneesByQuery(reversed, "971").map((r) => r.id)).toEqual([
      "3",
      "2",
      "1",
    ]);
  });

  it("pure-text query (no digits) does not match phones even by coincidence", () => {
    // "khouri" has no digits → phoneNeedle is empty → phone match
    // never fires. Only the name path triggers. Pin against future
    // regression where empty phoneNeedle is treated as "match all".
    expect(filterConsigneesByQuery(ROWS, "khouri").map((r) => r.id)).toEqual([
      "1",
    ]);
  });

  it("digits-only query searches phones AND names that contain digits", () => {
    // Boolean OR: a name-or-phone substring match returns the row.
    // "1234" matches the phone digits 971501234567 (Sarah) and no
    // names contain "1234".
    expect(filterConsigneesByQuery(ROWS, "1234").map((r) => r.id)).toEqual(["1"]);
  });
});
