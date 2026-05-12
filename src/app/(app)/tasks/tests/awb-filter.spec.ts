// Day-22 §3.22 fixup — /tasks AWB search filter tests.

import { describe, expect, it } from "vitest";

import type { Task } from "@/modules/tasks/types";

import { filterTasksByAwb } from "../awb-filter";

function row(overrides: Partial<Task>): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "00000000-0000-0000-0000-00000000000a",
    consigneeId: "00000000-0000-0000-0000-00000000000b",
    subscriptionId: null,
    createdVia: "manual_admin",
    customerOrderNumber: "ORDER-1",
    referenceNumber: null,
    internalStatus: "CREATED",
    deliveryDate: "2026-05-12",
    deliveryStartTime: "09:00:00",
    deliveryEndTime: "11:00:00",
    deliveryType: null,
    taskKind: "delivery",
    paymentMethod: null,
    codAmount: null,
    declaredValue: null,
    weightKg: null,
    notes: null,
    signatureRequired: false,
    smsNotifications: false,
    deliverToCustomerOnly: false,
    externalId: null,
    externalTrackingNumber: null,
    pushedToExternalAt: null,
    addressId: null,
    podPhotos: null,
    podRating: null,
    podFailureReason: null,
    driverName: null,
    createdAt: "2026-05-11T07:00:00.000Z",
    updatedAt: "2026-05-11T07:00:00.000Z",
    ...overrides,
  } as Task;
}

const ROWS: readonly Task[] = [
  row({ id: "1", externalTrackingNumber: "MPL-685000001" }),
  row({ id: "2", externalTrackingNumber: "MPL-685000002" }),
  row({ id: "3", externalTrackingNumber: "MPL-927600002" }),
  row({ id: "4", externalTrackingNumber: null }), // pre-push, no AWB
  row({ id: "5", externalTrackingNumber: "AWB-XYZ-99999" }),
];

describe("filterTasksByAwb", () => {
  it("returns the full list on empty query", () => {
    expect(filterTasksByAwb(ROWS, "")).toEqual(ROWS);
  });

  it("returns the full list on whitespace-only query", () => {
    expect(filterTasksByAwb(ROWS, "   ")).toEqual(ROWS);
  });

  it("filters by AWB substring (case-insensitive)", () => {
    expect(filterTasksByAwb(ROWS, "mpl").map((t) => t.id).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(filterTasksByAwb(ROWS, "MPL").map((t) => t.id).sort()).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("filters by trailing digits (e.g. last 6 of AWB)", () => {
    expect(filterTasksByAwb(ROWS, "000001").map((t) => t.id)).toEqual(["1"]);
    // "0002" appears in BOTH MPL-685000002 AND MPL-927600002 (trailing
    // 4 digits) — boundary case where two AWBs share a fragment.
    expect(filterTasksByAwb(ROWS, "0002").map((t) => t.id).sort()).toEqual([
      "2",
      "3",
    ]);
    // "000002" is contiguous only in MPL-685000002 — the other ends
    // in 600002 (no 6-zero run).
    expect(filterTasksByAwb(ROWS, "000002").map((t) => t.id)).toEqual(["2"]);
  });

  it("excludes tasks with null externalTrackingNumber when query is active", () => {
    expect(filterTasksByAwb(ROWS, "MPL").find((t) => t.id === "4")).toBeUndefined();
  });

  it("includes tasks with null AWB only when query is empty", () => {
    expect(filterTasksByAwb(ROWS, "").map((t) => t.id)).toContain("4");
  });

  it("returns empty when nothing matches", () => {
    expect(filterTasksByAwb(ROWS, "zzz-nomatch")).toEqual([]);
  });

  it("matches the unique AWB-XYZ pattern", () => {
    expect(filterTasksByAwb(ROWS, "XYZ").map((t) => t.id)).toEqual(["5"]);
    expect(filterTasksByAwb(ROWS, "xyz").map((t) => t.id)).toEqual(["5"]);
  });

  it("preserves source-array order in the filtered output", () => {
    // ROWS order: 1, 2, 3, 4, 5. Query "MPL" matches 1, 2, 3 in that
    // exact order — not sorted alphabetically.
    expect(filterTasksByAwb(ROWS, "MPL").map((t) => t.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
