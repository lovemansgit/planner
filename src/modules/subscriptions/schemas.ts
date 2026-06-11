// Boundary Zod schemas for the subscriptions module.
//
// Lives in the module rather than the route file so the schemas can be
// regression-tested without spinning up a route handler. Same pattern
// as src/modules/tasks/schemas.ts: schemas with a real regression
// guard land here; route-local one-liners (e.g., `IdParamSchema` in
// the [id] routes) stay co-located with their route.
//
// Boundary discipline (per consignees / tasks precedent):
//   - Schemas catch SHAPE errors (wrong type, missing required field)
//     and produce a 400 ValidationError.
//   - Business validation (trim non-empty, ISO 1-7 domain checks,
//     state transitions) lives in the service layer. The boundary
//     trusts NO inputs; the service trusts NO callers either.
//   - `.strict()` on update bodies rejects unknown keys with
//     `unrecognized_keys`. Drift from .strict() would let a typo
//     (`{"start_date": "..."}` instead of `{"startDate": "..."}`)
//     succeed and silently drop the user's intended change.
//   - `daysOfWeek` is validated for the ISO 1-7 domain at the boundary
//     too — the service ALSO validates, but a meaningful 400 from the
//     boundary beats a generic ValidationError thrown from deeper in
//     the stack when someone POSTs `{"daysOfWeek": [9]}`.

import { z } from "zod";

/**
 * Subset of the SubscriptionStatus union that an API caller can
 * legitimately seed at create time. 'ended' is excluded — creating a
 * subscription already in the terminal state has no use case and
 * would invite confusion. The service layer's `endSubscription`
 * transition is the only path to 'ended'.
 */
const CreateStatusSchema = z.enum(["active", "paused"]);

/**
 * One ISO weekday value: integer 1–7 (Mon=1, Sun=7) per the 0009
 * CHECK. Service-layer `validateDaysOfWeek` repeats this check; we
 * enforce here for friendlier 400-error messages.
 */
const WeekdaySchema = z.number().int().min(1).max(7);

/**
 * `daysOfWeek` array — non-empty, every element in domain.
 */
const DaysOfWeekSchema = z.array(WeekdaySchema).nonempty({
  message: "daysOfWeek must contain at least one weekday (1=Mon … 7=Sun)",
});

/**
 * Body shape for `POST /api/subscriptions`. Mirrors
 * `CreateSubscriptionInput` from the subscriptions module — every
 * required column from 0009 is required here too. Optional/nullable
 * fields permit either omission or explicit null; the service
 * collapses both to NULL on insert.
 *
 * `.strict()` rejects unknown keys to surface typos at the boundary
 * rather than silently dropping them.
 */
export const CreateSubscriptionBodySchema = z
  .object({
    consigneeId: z.string().uuid({ message: "consigneeId must be a uuid" }),
    status: CreateStatusSchema.optional(),
    startDate: z.string(),
    endDate: z.string().nullable().optional(),
    daysOfWeek: DaysOfWeekSchema,
    deliveryWindowStart: z.string(),
    deliveryWindowEnd: z.string(),
    deliveryAddressOverride: z.unknown().nullable().optional(),
    mealPlanName: z.string().nullable().optional(),
    externalRef: z.string().nullable().optional(),
    notesInternal: z.string().nullable().optional(),
  })
  .strict();

/**
 * Body shape for the lifecycle sub-routes
 * (`POST /api/subscriptions/:id/{pause,resume,end}`). These endpoints
 * take NO input — the id is path-only and the transition is the
 * verb. An incoming body MAY be empty (`{}`) or absent; ANY key in
 * the body is rejected to prevent footguns like
 * `POST .../pause { status: "ended" }` silently doing the wrong
 * thing. Routes apply this schema only when a body is actually
 * present (req.json() resolves to a value); a missing body bypasses
 * the schema entirely.
 *
 * `.strict()` is the regression target: dropping it would let a
 * caller stuff a `status` field into a /pause request and have it
 * silently dropped at parse time. Tests pin rejection of the three
 * lifecycle column names explicitly.
 */
export const LifecycleNoBodySchema = z.object({}).strict();

/**
 * Day-16 / Block 4-C — body shape for `POST /api/subscriptions/:id/pause`
 * per merged plan §6.1 + brief §3.1.7. All fields required (idempotency_key
 * is ALWAYS client-supplied per merged plan §6.5 idempotency-key locked
 * Zod contract).
 */
const ISO_DATE_REGEX_PAUSE = /^\d{4}-\d{2}-\d{2}$/;
export const PauseSubscriptionBodySchema = z
  .object({
    pause_start: z
      .string()
      .regex(ISO_DATE_REGEX_PAUSE, { message: "pause_start must be YYYY-MM-DD" }),
    pause_end: z
      .string()
      .regex(ISO_DATE_REGEX_PAUSE, { message: "pause_end must be YYYY-MM-DD" }),
    reason: z.string().optional(),
    idempotency_key: z
      .string()
      .uuid({ message: "idempotency_key must be a uuid" }),
  })
  .strict();

/**
 * Day-16 / Block 4-C — body shape for `POST /api/subscriptions/:id/resume`.
 * Manual resume only (auto-resume is internal — cron handler bypasses
 * the route). idempotency_key required per §6.5 contract.
 */
export const ResumeSubscriptionBodySchema = z
  .object({
    idempotency_key: z
      .string()
      .uuid({ message: "idempotency_key must be a uuid" }),
  })
  .strict();

/**
 * Body shape for `PATCH /api/subscriptions/:id`. Mirrors
 * `UpdateSubscriptionPatch`: every field optional. Lifecycle columns
 * (`status`, `pausedAt`, `endedAt`) are NOT in this schema —
 * transitions go through the dedicated `/pause` `/resume` `/end`
 * sub-routes per the audit-event-per-permission model from S-4.
 *
 * `.strict()` is the regression target: dropping it would let
 * `{"days_of_week": [...]}` (snake_case typo) succeed at parse time
 * and silently no-op. Tests pin this.
 */
export const UpdateSubscriptionBodySchema = z
  .object({
    consigneeId: z.string().uuid({ message: "consigneeId must be a uuid" }).optional(),
    startDate: z.string().optional(),
    endDate: z.string().nullable().optional(),
    daysOfWeek: DaysOfWeekSchema.optional(),
    deliveryWindowStart: z.string().optional(),
    deliveryWindowEnd: z.string().optional(),
    deliveryAddressOverride: z.unknown().nullable().optional(),
    mealPlanName: z.string().nullable().optional(),
    externalRef: z.string().nullable().optional(),
    notesInternal: z.string().nullable().optional(),
  })
  .strict();
