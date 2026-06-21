// A1 fix (plan #532 §Phase-3) — the creation-time delivery note must reach
// the SuiteFleet CREATE wire body. The note is captured on the consignee
// record (consignees.delivery_notes) and, until this fix, dead-ended there:
// the materialized task carries notes=NULL and `buildTaskCreateRequest` read
// only `task.notes`, so the SF `notes` field was undefined on first push.
//
// These tests pin the contract at the single push funnel every creation path
// (subscription-materialized AND ad-hoc) flows through — so the consignee
// default rides the existing outbound, and a per-task R3 note always wins.

import { describe, expect, it } from "vitest";

import { buildTaskCreateRequest, type ConsigneePushSnapshot } from "../build-create-request";
import type { Task } from "@/modules/tasks/types";
import type { Uuid } from "@/shared/types";

const TENANT_ID = "11111111-1111-1111-1111-111111111111" as Uuid;

function makeConsignee(deliveryNotes: string | null): ConsigneePushSnapshot {
  return {
    id: "22222222-2222-2222-2222-222222222222" as Uuid,
    name: "Zoro",
    phone: "+971500000000",
    email: null,
    addressLine: "Marina Tower 1",
    emirateOrRegion: "Dubai",
    district: "Dubai Marina",
    deliveryNotes,
  };
}

function makeTask(notes: string | null): Task {
  // Only the fields buildTaskCreateRequest reads matter for this pure-function
  // contract; the rest are filled to satisfy the shape.
  return {
    customerOrderNumber: "SUB-abc123def456-20260701",
    referenceNumber: null,
    taskKind: "DELIVERY",
    deliveryDate: "2026-07-01",
    deliveryStartTime: "09:00:00",
    deliveryEndTime: "12:00:00",
    weightKg: null,
    notes,
    signatureRequired: false,
    smsNotifications: false,
    deliverToCustomerOnly: false,
  } as unknown as Task;
}

describe("buildTaskCreateRequest — A1 creation delivery-note → SF wire", () => {
  it("seeds the SF wire `notes` from the consignee delivery note when the task has none", () => {
    const request = buildTaskCreateRequest(
      TENANT_ID,
      makeTask(null),
      makeConsignee("Leave at reception, call on arrival"),
    );
    expect(request.notes).toBe("Leave at reception, call on arrival");
  });

  it("lets a per-task note (R3) win over the consignee default", () => {
    const request = buildTaskCreateRequest(
      TENANT_ID,
      makeTask("Gate code 4417 — back entrance"),
      makeConsignee("Leave at reception, call on arrival"),
    );
    expect(request.notes).toBe("Gate code 4417 — back entrance");
  });

  it("sends no note when neither the task nor the consignee carries one", () => {
    const request = buildTaskCreateRequest(TENANT_ID, makeTask(null), makeConsignee(null));
    expect(request.notes).toBeUndefined();
  });
});
