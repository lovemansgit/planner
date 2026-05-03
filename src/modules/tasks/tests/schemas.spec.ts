// Boundary-schema regression tests for the tasks module.
//
// Pins UpdateTaskBodySchema's .strict() behaviour and the empty-body
// no-op contract. Without .strict(), Zod would silently strip unknown
// keys at parse time — a typo'd field name (`{"note": "x"}` instead
// of `{"notes": "x"}`) would be accepted, dropped, and the user's
// intended change would never reach the service layer. The tests
// below ensure that future changes to the schema cannot regress this
// behaviour without breaking the build.

import { describe, expect, it } from "vitest";

import { UpdateTaskBodySchema } from "../schemas";

describe("UpdateTaskBodySchema strict mode", () => {
  it("rejects unknown keys", () => {
    const result = UpdateTaskBodySchema.safeParse({ notes: "ok", foo: "bar" });
    expect(result.success).toBe(false);
  });

  it("accepts an empty object", () => {
    // Empty PATCH body is a well-defined no-op at the route layer:
    // the service short-circuits to a tenant-scoped read of the
    // current row. Zod must let it through so the route reaches the
    // service.
    const result = UpdateTaskBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an invalid enum value", () => {
    const result = UpdateTaskBodySchema.safeParse({ internalStatus: "INVALID_STATE" });
    expect(result.success).toBe(false);
  });
});
