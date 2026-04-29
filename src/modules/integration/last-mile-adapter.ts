// LastMileAdapter — plan §3.3 / §5 / ADR-007.
//
// The integration boundary callers depend on. Six methods, no provider
// vocabulary in the signatures. The SuiteFleet implementation lives
// under providers/suitefleet/ and is constructed by `getLastMileAdapter`
// (lands later in Day 4 once auth + credential plumbing is in place).
//
// Day-4 commits implementing each method:
//   authenticate          — S-2 (auth client) + S-3 (cred resolver) + S-7 (cache)
//   refreshSession        — S-2 + S-7
//   createTask            — S-8
//   verifyWebhookRequest  — S-4
//   parseWebhookEvents    — S-5
//   mapStatusToInternal   — S-6
//
// Why these six and not, say, `getTask` / `cancelTask` / `listTasks`:
// Day-4 demo target is the create-then-webhook round-trip. The remaining
// CRUD lands Day 5+ alongside the task module and adds methods to this
// interface as it does (not breaking changes — additions only).

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
  verifyWebhookRequest(headers: HeadersLike, body: unknown): WebhookVerificationResult;
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
