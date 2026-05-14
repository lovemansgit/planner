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
//
// Day 21 / Phase 1 / SF outbound: three additional methods —
// updateTask, cancelTask, bulkCancelTasks — land for the merchant-
// operator CRUD lane. Signatures locked post Day-20 doc-verification
// (memory/decision_phase_1_aqib_doc_verified.md Q1-Q4 ✓; Q5/Q6
// closed) plus Day-21 sandbox probe lock on the cancel field name
// (`status: "CANCELED"`) and the bulk-endpoint identifier (numeric SF
// task ids, not AWBs — empirical correction of the Q3 memo's AWB
// claim).

import type {
  AssetTrackingPackage,
  AuthenticatedSession,
  BulkCancelResult,
  HeadersLike,
  InternalTaskStatus,
  TaskByAwbResult,
  TaskCreateRequest,
  TaskCreateResult,
  TaskUpdatePatchRequest,
  WebhookEvent,
  WebhookVerificationResult,
} from "./types";
import type { Uuid } from "@/shared/types";

export interface LastMileAdapter {
  authenticate(tenantId: Uuid): Promise<AuthenticatedSession>;
  refreshSession(session: AuthenticatedSession): Promise<AuthenticatedSession>;
  /**
   * Day 26 / T3. Drop the cached session for one tenant without
   * triggering a re-login. Called by the credentials service on
   * initial-set AND rotation (ratified OQ-5) so the next push for
   * this tenant resolves fresh credentials against the new Vault
   * row. Idempotent — no-op if no session is cached.
   */
  invalidateSession(tenantId: Uuid): void;
  createTask(
    session: AuthenticatedSession,
    task: TaskCreateRequest,
  ): Promise<TaskCreateResult>;
  /**
   * Day 8 / D8-4b. Look up the existing provider-side task by its AWB
   * and return the minimal `{ externalId }` shape the cron's
   * AWB-exists reconcile branch needs. Throws typed errors so callers
   * can branch on parse-vs-network-vs-auth without parsing messages
   * (SuiteFleet implementation: `SuiteFleetTimelineParseError` on
   * shape mismatch; `CredentialError` on auth failures or 5xx;
   * `ValidationError` on other 4xx).
   *
   * The full timeline / task-activities payload is intentionally NOT
   * exposed — see `TaskByAwbResult` jsdoc for the rationale.
   */
  getTaskByAwb(
    session: AuthenticatedSession,
    awb: string,
  ): Promise<TaskByAwbResult>;
  /**
   * Day 8 / D8-6. Generate shipment labels for one or more tasks and
   * return the rendered PDF as a Buffer. Provider-internal URL
   * construction (the SuiteFleet implementation builds a
   * token-in-query URL against a separate label-domain endpoint and
   * fetches it server-side; the URL never leaves the deploy
   * boundary). The Buffer return shape is pilot-scope (≤100 tasks
   * per request, few-MB PDFs); a future Streaming variant lifts the
   * cap.
   *
   * Throws:
   *   - `CredentialError`   auth failure or 5xx from the provider
   *                         (single-attempt policy mirrors createTask)
   *   - `ValidationError`   provider returned 4xx; response excerpt in
   *                         message for forensic logging
   */
  printLabels(
    session: AuthenticatedSession,
    taskIds: readonly string[],
  ): Promise<Buffer>;
  /**
   * Fetch the asset-tracking records for a given AWB. Returns the
   * unwrapped `content[]` array from SF's Spring Data paginated
   * response — pagination wrapper handling lives inside the adapter
   * (provider-specific concern), not exposed to callers. One result
   * per package: a single AWB with N packages returns N records.
   *
   * Rate-limit posture: the adapter applies the same conservative
   * 5 req/sec throttle as the rest of the SuiteFleet path. Call from
   * the read-through cache layer (B-2 service) only — never on hot
   * UI paths.
   *
   * Returns `[]` when no records are attached to the AWB. Throws
   * `CredentialError` on auth failures or 5xx; throws
   * `ValidationError` on response-shape parse failures (a Day-4
   * lesson — do not silently coerce surprises).
   *
   * Vendor question: pagination behaviour for AWBs with > 50
   * packages is unconfirmed (memory/followup_suitefleet_asset_tracking_api.md
   * question 2). The adapter currently returns only the first page
   * and logs a warning if `totalPages > 1`. Pagination wiring is a
   * B-2 follow-up if it ever surfaces in production.
   */
  fetchAssetTrackingByAwb(
    session: AuthenticatedSession,
    awb: string,
  ): Promise<readonly AssetTrackingPackage[]>;
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
   * Day 21 / Phase 1. Update an existing provider-side task via merge-
   * patch. SuiteFleet implementation uses
   * `PATCH /api/tasks/awb/{awb}` with `Content-Type:
   * application/merge-patch+json` (RFC 7396 — only present fields are
   * updated). The full task entity is returned 200 OK and explicitly
   * discarded — Day-21 sandbox probe confirmed the response shape is
   * 200 + body, NOT 204.
   *
   * Single-attempt by design (mirrors `createTask` + `getTaskByAwb`).
   * QStash decoupling (Day-14 cron-decoupling pattern) handles retry
   * via `/api/queue/update-task-failed` failureCallback into the
   * `outbound_push_failures` DLQ. Caller treats any throw as
   * DLQ-routable.
   *
   * Throws:
   *   - CredentialError   auth failure / 5xx / network error
   *   - ValidationError   provider 4xx
   */
  updateTask(
    session: AuthenticatedSession,
    awb: string,
    patch: TaskUpdatePatchRequest,
  ): Promise<void>;
  /**
   * Day 21 / Phase 1. Cancel an existing provider-side task. SuiteFleet
   * implementation uses `PATCH /api/tasks/awb/{awb}` with body
   * `{ "status": "CANCELED" }` (Day-21 sandbox probe locked the field
   * name; see `memory/decision_phase_1_aqib_doc_verified.md` Q2).
   *
   * Fire-and-forget at the adapter layer: SuiteFleet fires
   * `TASK_STATUS_UPDATED_TO_CANCELED` (~1s post-PATCH) which the
   * existing webhook receiver (`apply-webhook-status-event.ts`)
   * applies to local `tasks.internal_status`. The adapter does NOT
   * write local DB. The doc-verified memo's idempotency posture
   * extends here unchanged: SF does not dedupe; replay safety lives
   * Planner-side via QStash + `correlation_id` (passed in for
   * traceability + DLQ row + audit log only — does NOT cross the
   * wire because SF ignores `Idempotency-Key`; see Day-4
   * createTask idempotency-policy block in
   * `providers/suitefleet/task-client.ts`).
   *
   * Same single-attempt + throw contract as `updateTask`.
   */
  cancelTask(
    session: AuthenticatedSession,
    awb: string,
    correlationId: string,
  ): Promise<void>;
  /**
   * Day 21 / Phase 1. Bulk-cancel via single SuiteFleet bulk call —
   * `PATCH /api/tasks/bulk/{numeric_ids_csv}` with body
   * `{ "status": "CANCELED" }` (single merge-patch applied to all listed
   * tasks). Per Q3 doc-verified + plan §G.1: NOT parallel single-cancel
   * fan-out.
   *
   * IMPORTANT: input is **numeric SF task ids**, NOT AWB strings.
   * Day-21 sandbox probe — see code-PR §3.6 thread under cancelTask
   * side-finding section — empirically confirmed the bulk endpoint
   * expects numeric ids; AWB strings 500 with "For input string"
   * parse error. The doc-verified Q3 memo claim ("comma-separated AWB
   * list") was empirically wrong — the path-param name `{ids}` was the
   * tell, but the doc memo extrapolated from the Day-6 asset-tracking
   * `?awbs=` convention. Service-layer callers fetch
   * `tasks.external_id` (numeric stringified), NOT
   * `tasks.external_tracking_number` (AWB).
   *
   * Response is aggregate (job summary):
   * `{ jobId, executedCount, expectedCount, status }` —  NOT per-task
   * results. When `executedCount < expectedCount` the response does
   * not say WHICH tasks failed; treat the whole batch as
   * DLQ-routable.
   *
   * Same single-attempt policy as the single variants. Webhooks fire
   * per task in the bulk (Day-21 probe: 4 events for 2 tasks — same
   * 2-event fan-out as the single-cancel path).
   *
   * Throws:
   *   - CredentialError   auth failure / 5xx / network error
   *   - ValidationError   provider 4xx OR aggregate executedCount
   *                       diverges from expectedCount
   */
  bulkCancelTasks(
    session: AuthenticatedSession,
    sfTaskIds: readonly string[],
    correlationId: string,
  ): Promise<BulkCancelResult>;
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
