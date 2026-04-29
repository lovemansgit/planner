// LastMileAdapter — plan §3.3 / §5 / ADR-007.
//
// The integration boundary callers depend on. Six methods, no provider
// vocabulary in the signatures. The SuiteFleet implementation lives
// under providers/suitefleet/ and is constructed by
// `createSuiteFleetLastMileAdapter` (Day 5 / T-8).
//
// Day-4 commits implementing each method:
//   authenticate          — S-2 (auth client) + S-3 (cred resolver) + S-7 (cache)
//   refreshSession        — S-2 + S-7
//   createTask            — S-8
//   verifyWebhookRequest  — S-4
//   parseWebhookEvents    — S-5
//   mapStatusToInternal   — S-6
//
// Day-5 / T-8: assembled the primitives into one constructable
// adapter. As part of T-8 review, `verifyWebhookRequest` was changed
// to take `tenantId` as an explicit parameter and return a Promise.
// The Day-4 single-tenant sentinel was a placeholder for the
// per-tenant credential lookup that is now plumbed through the
// interface. Surfacing the per-tenant dependency at the interface
// level is cleaner than capturing a defaultTenantId sentinel inside
// the assembly closure (which would invert the dependency direction
// and bake the sentinel into every caller).
//
// Why these six and not, say, `getTask` / `cancelTask` / `listTasks`:
// Day-4 demo target is the create-then-webhook round-trip. The remaining
// CRUD lands later when the cron / webhook receiver / task-update
// callers exist; the interface grows by addition.

import type {
  AuthenticatedSession,
  HeadersLike,
  InternalTaskStatus,
  TaskCreateRequest,
  TaskCreateResult,
  WebhookEvent,
  WebhookVerificationResult,
} from "./types";
import type { Uuid } from "@/shared/types";

export interface LastMileAdapter {
  authenticate(tenantId: Uuid): Promise<AuthenticatedSession>;
  refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession>;
  createTask(
    session: AuthenticatedSession,
    task: TaskCreateRequest,
  ): Promise<TaskCreateResult>;
  /**
   * Verify an inbound webhook request against the tenant-specific
   * webhook credentials. tenantId is supplied by the route handler
   * (post-Day-5 dynamic route `/api/webhooks/suitefleet/[tenantId]`).
   * Async because credential resolution is async (env reads today;
   * AWS Secrets Manager once the swap lands).
   */
  verifyWebhookRequest(
    tenantId: Uuid,
    headers: HeadersLike,
    body: unknown,
  ): Promise<WebhookVerificationResult>;
  parseWebhookEvents(body: unknown): readonly WebhookEvent[];
  /**
   * Maps a provider-native status / event identifier to one of the
   * seven internal lifecycle states.
   *
   * Returns `null` when the input is not a lifecycle-changing event —
   * for example, a SuiteFleet `TASK_HAS_BEEN_UPDATED` (an edit, not a
   * status change) or an unknown action vocabulary the implementation
   * doesn't recognise.
   *
   * Caller contract: `null` means "do not update the task's state on
   * this event." This makes the no-regress invariant visible at every
   * call site rather than buried in downstream FSM logic.
   */
  mapStatusToInternal(externalStatus: string): InternalTaskStatus | null;
}
