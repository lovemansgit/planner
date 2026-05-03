// Boundary-schema regression tests for the subscriptions module.
//
// Pins .strict() behaviour, empty-body no-op contract on PATCH, and
// the daysOfWeek domain check at the boundary. These tests guard
// against silent regressions that would let typo'd or out-of-domain
// inputs slip past the schema and surface as deeper-stack errors
// (or, worse, get silently dropped on the way to the service).

import { describe, expect, it } from "vitest";

import {
  CreateSubscriptionBodySchema,
  LifecycleNoBodySchema,
  UpdateSubscriptionBodySchema,
} from "../schemas";

const validCreateBody = {
  // Zod 4's `.uuid()` enforces RFC 4122 version + variant digits — the
  // 13th nibble must be 1–8 (version), the 17th must be 8–b (variant).
  // A "11111111-1111-1111-1111-111111111111" string fails the variant
  // check; the fixture below is a valid UUIDv4.
  consigneeId: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-05-01",
  daysOfWeek: [1, 3, 5],
  deliveryWindowStart: "14:00:00",
  deliveryWindowEnd: "16:00:00",
};

describe("CreateSubscriptionBodySchema", () => {
  it("accepts a minimal valid body (only required fields)", () => {
    const result = CreateSubscriptionBodySchema.safeParse(validCreateBody);
    expect(result.success).toBe(true);
  });

  it("accepts every documented optional field", () => {
    const result = CreateSubscriptionBodySchema.safeParse({
      ...validCreateBody,
      status: "paused",
      endDate: "2026-12-31",
      deliveryAddressOverride: { line1: "Override" },
      mealPlanName: "Fit Plan",
      externalRef: "ext-123",
      notesInternal: "internal note",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys (.strict regression target)", () => {
    const result = CreateSubscriptionBodySchema.safeParse({
      ...validCreateBody,
      // Snake-case typo — without .strict() this would parse and the
      // intended field would never reach the service layer.
      days_of_week: [1, 2, 3],
    });
    expect(result.success).toBe(false);
  });

  it("rejects 'ended' as a create-time status (only active|paused permitted)", () => {
    const result = CreateSubscriptionBodySchema.safeParse({
      ...validCreateBody,
      status: "ended",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid consigneeId (must be uuid)", () => {
    const result = CreateSubscriptionBodySchema.safeParse({
      ...validCreateBody,
      consigneeId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty daysOfWeek", () => {
    const result = CreateSubscriptionBodySchema.safeParse({
      ...validCreateBody,
      daysOfWeek: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects daysOfWeek values outside ISO 1-7 domain", () => {
    for (const bad of [[0, 1, 2], [1, 8], [-1], [1.5]]) {
      const result = CreateSubscriptionBodySchema.safeParse({
        ...validCreateBody,
        daysOfWeek: bad,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects when a required field is missing", () => {
    const { startDate: _omit, ...rest } = validCreateBody;
    void _omit;
    const result = CreateSubscriptionBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

describe("UpdateSubscriptionBodySchema", () => {
  it("accepts an empty object (PATCH no-op contract)", () => {
    // An empty body is a well-defined no-op at the service layer:
    // before === after referentially, no UPDATE issued, no audit emit.
    // Zod must let it through so the route reaches the service.
    const result = UpdateSubscriptionBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial patch (only one field present)", () => {
    const result = UpdateSubscriptionBodySchema.safeParse({ mealPlanName: "New Plan" });
    expect(result.success).toBe(true);
  });

  it("accepts explicit null on nullable fields (clear semantics)", () => {
    const result = UpdateSubscriptionBodySchema.safeParse({
      mealPlanName: null,
      externalRef: null,
      endDate: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys (.strict regression target)", () => {
    const result = UpdateSubscriptionBodySchema.safeParse({ mealPlanName: "ok", foo: "bar" });
    expect(result.success).toBe(false);
  });

  it("rejects lifecycle column writes via PATCH (status / pausedAt / endedAt)", () => {
    // Lifecycle transitions go through dedicated /pause /resume /end
    // sub-routes per S-4. The PATCH body deliberately omits these
    // columns so a caller cannot bypass the audit-event-per-permission
    // model. .strict() enforces the omission.
    for (const bad of [
      { status: "paused" },
      { pausedAt: "2026-05-01T00:00:00Z" },
      { endedAt: "2026-05-01T00:00:00Z" },
    ]) {
      const result = UpdateSubscriptionBodySchema.safeParse(bad);
      expect(result.success).toBe(false);
    }
  });

  it("rejects daysOfWeek out of the ISO 1-7 domain when present", () => {
    const result = UpdateSubscriptionBodySchema.safeParse({ daysOfWeek: [9] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid consigneeId in a patch", () => {
    const result = UpdateSubscriptionBodySchema.safeParse({ consigneeId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("LifecycleNoBodySchema (pause / resume / end)", () => {
  it("accepts an empty object body", () => {
    // Lifecycle endpoints permit `{}` so clients that always send
    // `Content-Type: application/json` with an empty payload don't
    // hit a 400. The route layer additionally accepts an absent
    // body (handled before the schema runs).
    const result = LifecycleNoBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it.each([
    ["status"],
    ["pausedAt"],
    ["endedAt"],
  ])("rejects body containing a %s field", (field) => {
    // Footgun guard: a caller stuffing `status` or a lifecycle
    // timestamp into a /pause request must NOT be silently accepted
    // and dropped. The .strict() empty-object schema rejects any
    // key — these three field names are the highest-risk ones
    // (they parallel columns the lifecycle paths actually write).
    const body: Record<string, unknown> = { [field]: "anything" };
    const result = LifecycleNoBodySchema.safeParse(body);
    expect(result.success).toBe(false);
  });

  it("rejects an arbitrary unknown field too", () => {
    // Catch-all so a future change to .strict() drops the regression
    // pin even if no-one notices the named-field tests still pass.
    const result = LifecycleNoBodySchema.safeParse({ foo: "bar" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-object body (string / array / null)", () => {
    for (const bad of ["string", [], null]) {
      const result = LifecycleNoBodySchema.safeParse(bad);
      expect(result.success).toBe(false);
    }
  });
});
