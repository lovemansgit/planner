// Boundary Zod schemas for the tasks module.
//
// Lives in the module rather than the route file so the schema can be
// regression-tested without spinning up a route handler. Currently
// only `UpdateTaskBodySchema` lives here — extracted from the
// /api/tasks/[id] PATCH route to pin its .strict() behaviour against
// future regressions (a silent-drop of .strict() would let unknown
// keys slip through unnoticed).
//
// Other route-local schemas (e.g., the IdParamSchema in
// /api/tasks/[id]/route.ts) are NOT extracted — moving a schema here
// just to test it would invert the testability/usage trade-off; only
// schemas with a real regression-guard need land in this file.

import { z } from "zod";

/**
 * Patch shape for `PATCH /api/tasks/:id`. Mirrors `UpdateTaskPatch`
 * from the tasks module — identity, association, and lifecycle
 * columns are deliberately excluded.
 *
 * `.strict()` rejects unknown keys with a `unrecognized_keys` error
 * rather than silently stripping them. The strict mode is the
 * regression target: dropping it would let a typo'd field name
 * (`{"note": "x"}` instead of `{"notes": "x"}`) succeed at parse
 * time and silently drop the user's intended change. Tests in
 * src/modules/tasks/tests/schemas.spec.ts pin this behaviour.
 */
export const UpdateTaskBodySchema = z
  .object({
    customerOrderNumber: z.string().optional(),
    referenceNumber: z.string().optional(),
    internalStatus: z
      .enum(["CREATED", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED", "CANCELED", "ON_HOLD"])
      .optional(),
    deliveryDate: z.string().optional(),
    deliveryStartTime: z.string().optional(),
    deliveryEndTime: z.string().optional(),
    deliveryType: z.string().optional(),
    taskKind: z.enum(["DELIVERY", "PICKUP"]).optional(),
    paymentMethod: z.string().optional(),
    codAmount: z.string().optional(),
    declaredValue: z.string().optional(),
    weightKg: z.string().optional(),
    notes: z.string().optional(),
    signatureRequired: z.boolean().optional(),
    smsNotifications: z.boolean().optional(),
    deliverToCustomerOnly: z.boolean().optional(),
  })
  .strict();
