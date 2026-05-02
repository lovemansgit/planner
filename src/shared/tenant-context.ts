// Actor and RequestContext types per plan §7.4.1 + resolutions R-3 / R-6.
// Every callable service method takes a `RequestContext` and calls
// `requirePermission(ctx, perm)` per the §11.3 non-negotiable.

import type { Permission, Uuid } from "./types";

/**
 * System actors invoke service methods from infrastructure (Vercel
 * Cron, SuiteFleet webhooks, QStash consumers). Each has a hard-coded
 * permission set defined in `src/modules/identity/system-actors.ts`
 * per plan §7.4.2 (frozen — no runtime mutation, no configuration).
 *
 * The list reflects plan §7.4.2 plus the cron schedule in resolutions
 * R-6:
 *   - generate-tasks (20:05 daily)        — Vercel Cron
 *   - reconciliation (11:00 daily)        — Vercel Cron
 *   - end-expired (00:15 daily, R-6)      — Vercel Cron
 *   - scan-webhook-dlq (every 5m, R-6)    — Vercel Cron
 *   - webhook-worker                      — QStash consumer (post-R-6 it
 *                                           is no longer a cron, but the
 *                                           system-actor name is kept
 *                                           from plan §7.4.2)
 *   - suitefleet ingress                  — Stage-1 webhook endpoint
 */
export type SystemActor =
  | "cron:generate_tasks"
  | "cron:reconciliation"
  | "cron:end_expired"
  | "cron:scan_webhook_dlq"
  | "cron:webhook_worker"
  | "webhook:suitefleet"
  // Day 8 / D8-5 — internal bridge for the operator-driven DLQ
  // retry path. The /api/failed-pushes/[id]/retry route authorizes
  // a USER actor via `failed_pushes:retry`, then retryFailedPush
  // builds a context with this system actor to call into
  // task-push/service.ts's pushSingleTask (which requires a system
  // actor for assertSystemActor + recordFailedPushAttempt /
  // markFailedPushResolved). Operator attribution stays on the
  // operator-layer audit event (failed_push.retried, user actor);
  // this system-actor identity surfaces only on the system-layer
  // emits (task.pushed_via_reconcile / task.push_failed).
  | "system:dlq_retry";

/** Two-kind actor: human user (JWT) or system (cron / webhook / queue). */
export type Actor =
  | {
      kind: "user";
      userId: Uuid;
      tenantId: Uuid;
      permissions: ReadonlySet<Permission>;
      ipAddress?: string;
      userAgent?: string;
    }
  | {
      kind: "system";
      system: SystemActor;
      tenantId: Uuid | null; // null for cross-tenant system operations
      permissions: ReadonlySet<Permission>;
    };

export interface RequestContext {
  actor: Actor;
  tenantId: Uuid | null;
  requestId: string;
  path: string;
}
