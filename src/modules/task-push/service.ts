// task-push service — Day 8 / D8-4a.
//
// Per-tenant bulk push of newly-generated tasks to the last-mile
// adapter. Single-loop, sequential, throttled at 5 req/sec. Called
// once per tenant per cron pass, AFTER `generateTasksForWindow`
// (C-2) has finished generating that tenant's next-day tasks.
//
// -----------------------------------------------------------------------------
// Two fail-closed guards (D8-4a)
// -----------------------------------------------------------------------------
// 1. PER-TENANT — `tenants.suitefleet_customer_code IS NULL`:
//    The whole batch is skipped; one `tenant.push_skipped` audit
//    event emits with `reason='missing_customer_code'` and
//    `skipped_task_count: <N>`. Single event per tenant per pass —
//    NOT one per task — because the cause is a tenant-level config
//    gap, not per-task failure. Surfaces operationally as one alert
//    per tenant per pass instead of N alerts.
//
// 2. PER-TASK — `consignee.district === 'UNKNOWN'`:
//    The individual task is skipped; a `failed_pushes` row is
//    written via `recordFailedPushAttempt` (insert-or-update on
//    23505 partial UNIQUE) with `failureReason='unknown'` and
//    `failureDetail='unknown_district: ...'`. The audit
//    `task.push_failed` event emits with metadata
//    `reason: 'unknown_district'` (the audit metadata reason is a
//    string in JSONB; distinct from the DB-enum failure_reason).
//
// -----------------------------------------------------------------------------
// 23505 / AWB-exists handling (D8-4b reconcile)
// -----------------------------------------------------------------------------
// On `SuiteFleetAwbExistsError` from the adapter, D8-4b's reconcile
// branch:
//   1. Calls `adapter.getTaskByAwb(session, awb)` — GET
//      /api/tasks/awb/{awb}/task-activities — to extract the existing
//      SF task id from the timeline payload.
//   2. Calls `markTaskPushed(taskId, externalId, awb)` to set
//      external_id / external_tracking_number / pushed_to_external_at.
//      tracking_number = the AWB itself (we already have it; SF echoes
//      it back).
//   3. Calls `markFailedPushResolved(ctx, taskId, "reconciled-via-awb-D8-4b")`
//      to close out any unresolved failed_pushes row from a prior
//      parse-only-era cron pass. Idempotent — no-op when no DLQ row
//      exists. The boolean return value lands in the audit metadata.
//   4. Emits `task.pushed_via_reconcile` with task_id / external_id /
//      awb / customer_order_number / prior_failed_push_resolved.
//   5. Increments `awbExistsReconciled` on PushTenantOutcome.
//
// On reconcile FAILURE (getTaskByAwb threw — network, auth, parse
// error, or 4xx other than the AWB-exists itself), the task stays
// unpushed and a failed_pushes row is recorded with a distinguishing
// failure_detail prefix `awb_exists_reconcile_failed: <awb>; getTaskByAwb error: <msg>`
// (vs D8-4a's `awb_exists: <awb>` prefix). Operators on
// /admin/failed-pushes can tell parse-only-era rows apart from
// reconcile-attempted-and-failed rows. Counter posture: the failure
// counts as `awbExists`, NOT a third counter — see
// `task-push/types.ts` PushTenantOutcome jsdoc for the rationale.
//
// Doc-derived parser caveat: the timeline response shape the parser
// validates against is from SF docs reading (suitefleet.readme.io,
// 4 May 2026), not capture-derived. The third cron trigger
// (2 May 2026) hit a clean first-time push so no live timeline was
// captured. First production 23505/AWB-exists either validates or
// invalidates the fixture; on invalidation the parser throws
// `SuiteFleetTimelineParseError` which surfaces in failure_detail
// as a clear divergence signal rather than silent mis-extraction.
//
// -----------------------------------------------------------------------------
// shipFrom posture (D8-4a — wire-pollution fix per reviewer)
// -----------------------------------------------------------------------------
// Per memory/followup_webhook_auth_architecture.md, SF auto-populates
// shipFrom from the merchant master when the create payload omits
// it entirely. Sending a synthetic placeholder = wire pollution; SF
// would overwrite anyway but the request body carries fake data.
//
// D8-4a's wire-side fix:
//   - buildSuiteFleetTaskBody conditionally spreads shipFrom only
//     when defined — so `request.shipFrom === undefined` produces a
//     payload with NO shipFrom field (SF auto-population kicks in).
//   - The cron-path `buildTaskCreateRequest` returns
//     Omit<TaskCreateRequest, "shipFrom"> so callers don't construct
//     a synthetic placeholder. The adapter call casts through to
//     TaskCreateRequest at the boundary.
//
// The TaskCreateRequest type still types shipFrom as required; the
// type-level relaxation (parallel to the D8-3 lat/lng pattern) stays
// Day 9+ to avoid contract churn alongside the cron wiring. The
// runtime-side fix above is sufficient — the cast is a deliberate,
// documented bridge between a relaxed cron-path type and the
// stricter public adapter contract.

import { emit } from "../audit";
import {
  markFailedPushResolved,
  recordFailedPushAttempt,
  type FailureReason,
} from "../failed-pushes";
import {
  type LastMileAdapter,
  type DeliveryAddress,
  type TaskCreateRequest,
} from "../integration";
import { SuiteFleetAwbExistsError } from "../integration";
import { listUnpushedTasksByTenant, markTaskPushed } from "../tasks/repository";
import type { Task } from "../tasks/types";

import { withServiceRole } from "../../shared/db";
import { CredentialError, ForbiddenError, ValidationError } from "../../shared/errors";
import { logger } from "../../shared/logger";
import { captureException } from "../../shared/sentry-capture";
import type { Actor, RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

import { sql as sqlTag } from "drizzle-orm";

import { findTaskById } from "../tasks/repository";

import type { PushTenantOutcome, SinglePushOutcome } from "./types";

const log = logger.with({ component: "task_push_service" });

/** 5 req/sec — sequential await sleep(200ms) between SF calls. */
const SF_THROTTLE_MS = 200;

/** Sentinel value the D8-2 schema migration backfilled for missing district. */
const UNKNOWN_DISTRICT_SENTINEL = "UNKNOWN";

// -----------------------------------------------------------------------------
// Tenant + consignee lookups
// -----------------------------------------------------------------------------

interface TenantPushConfig {
  readonly tenantId: Uuid;
  readonly suitefleetCustomerCode: string | null;
}

interface ConsigneePushSnapshot {
  readonly id: Uuid;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly addressLine: string;
  readonly emirateOrRegion: string;
  readonly district: string;
}

type TenantConfigRow = {
  suitefleet_customer_code: string | null;
} & Record<string, unknown>;

type ConsigneeRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address_line: string;
  emirate_or_region: string;
  district: string;
} & Record<string, unknown>;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function actorIdFor(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.system;
}

function assertSystemActor(ctx: RequestContext, op: string): void {
  if (ctx.actor.kind !== "system") {
    throw new ForbiddenError(`${op} requires a system actor`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Translate adapter-layer errors to the failed_pushes failure_reason
 * enum. The DB CHECK is restrictive (network | server_5xx |
 * client_4xx | timeout | unknown); we map adapter exceptions onto
 * those buckets. The pre-flight unknown-district guard does NOT
 * round-trip through this mapper — it uses 'unknown' directly with
 * a descriptive failure_detail string.
 *
 * D8-4b: SuiteFleetAwbExistsError is intentionally NOT handled here —
 * the AWB-exists case routes through the reconcile branch (which
 * doesn't classify as a generic failure unless the reconcile itself
 * fails). The reconcile-failure path constructs its own classified
 * shape inline via `classifyReconcileError` so the failure_detail
 * carries the load-bearing `awb_exists_reconcile_failed:` prefix.
 */
function classifyAdapterError(err: unknown): {
  reason: FailureReason;
  detail: string;
  httpStatus?: number;
} {
  if (err instanceof CredentialError) {
    // CredentialError covers both 5xx and network errors per
    // task-client.ts's "single-attempt policy, no retry" handling;
    // we can't distinguish them at this layer without parsing the
    // message. Categorise as 'unknown' — operators see the
    // failure_detail for the actual cause.
    const msg = err.message;
    const reason: FailureReason = msg.includes("network error")
      ? "network"
      : msg.includes("5") && msg.includes("0") // 500/502/503/504 — sloppy but adequate
        ? "server_5xx"
        : "unknown";
    return { reason, detail: msg.slice(0, 4000) };
  }
  if (err instanceof ValidationError) {
    return { reason: "client_4xx", detail: err.message.slice(0, 4000) };
  }
  return {
    reason: "unknown",
    detail: err instanceof Error ? err.message.slice(0, 4000) : String(err).slice(0, 4000),
  };
}

/**
 * D8-4b: classify a reconcile-failure (i.e. SF returned 23505/AWB-exists
 * AND getTaskByAwb subsequently threw). The `awb_exists_reconcile_failed:`
 * prefix on `failureDetail` is load-bearing — operators on
 * /admin/failed-pushes use it to tell parse-only-era DLQ rows
 * (`awb_exists:` prefix, never seen in production but possible from a
 * pre-D8-4b cron pass) apart from reconcile-attempted-and-failed rows.
 *
 * Reuses `classifyAdapterError` for the underlying reason/httpStatus
 * extraction (CredentialError → network/server_5xx, ValidationError /
 * SuiteFleetTimelineParseError → client_4xx, etc.) and prefixes the
 * detail string. The SuiteFleetTimelineParseError class extends Error
 * but not ValidationError; it falls into the catch-all 'unknown'
 * bucket from classifyAdapterError, which is the right behaviour
 * (the parser-mismatch is a vendor-shape divergence, not a
 * client-side bug — 'unknown' is the most honest enum value). The
 * detail string carries the explicit parse-error message regardless.
 */
function classifyReconcileError(awb: string, err: unknown): {
  reason: FailureReason;
  detail: string;
  httpStatus?: number;
} {
  const inner = classifyAdapterError(err);
  return {
    reason: inner.reason,
    detail: `awb_exists_reconcile_failed: '${awb}'; getTaskByAwb error: ${inner.detail}`.slice(0, 4000),
    httpStatus: inner.httpStatus,
  };
}

/**
 * Cron-path TaskCreateRequest variant that omits shipFrom. SF
 * auto-populates shipFrom from the merchant master when the create
 * payload omits it entirely; the cron path deliberately doesn't
 * construct a placeholder. See header `shipFrom posture` block.
 */
type CronTaskCreateRequest = Omit<TaskCreateRequest, "shipFrom">;

/**
 * Map a Task + ConsigneeSnapshot + tenant customer_code into the
 * internal-language `TaskCreateRequest` the adapter expects (minus
 * shipFrom — see CronTaskCreateRequest above).
 *
 * Locked defaults (per Aqib Group-1):
 *   - countryCode = 'AE' (UAE pilot)
 *   - paymentMethod = 'PrePaid' (top-level, not nested — D8-3 fix)
 *   - itemQuantity = 1 (single bag per meal-plan delivery)
 *   - codAmount = 0, declaredValue = 0 (prepaid)
 *   - city = consignee.emirate_or_region (one-string-fits-both for
 *     UAE pilot per option-1 lean in the C-3 deferred memo)
 *   - shipFrom OMITTED — SF auto-populates from merchant master
 */
function buildTaskCreateRequest(
  tenantId: Uuid,
  task: Task,
  consignee: ConsigneePushSnapshot,
): CronTaskCreateRequest {
  const consigneeAddress: DeliveryAddress = {
    addressLine1: consignee.addressLine,
    city: consignee.emirateOrRegion,
    district: consignee.district,
    countryCode: "AE",
  };
  return {
    tenantId,
    customerOrderNumber: task.customerOrderNumber,
    referenceNumber: task.referenceNumber ?? undefined,
    kind: task.taskKind,
    consignee: {
      name: consignee.name,
      contactPhone: consignee.phone,
      address: consigneeAddress,
    },
    window: {
      date: task.deliveryDate,
      startTime: task.deliveryStartTime,
      endTime: task.deliveryEndTime,
    },
    paymentMethod: "PrePaid",
    codAmount: 0,
    declaredValue: 0,
    weightKg: task.weightKg !== null ? Number(task.weightKg) : 0,
    itemQuantity: 1,
    notes: task.notes ?? undefined,
    signatureRequired: task.signatureRequired,
    smsNotifications: task.smsNotifications,
    deliverToCustomerOnly: task.deliverToCustomerOnly,
  };
}

// -----------------------------------------------------------------------------
// pushTasksForTenant — public entry point
// -----------------------------------------------------------------------------

/**
 * D8-4a — bulk push for one tenant. Caller is the cron handler.
 *
 * Outcome union (see ./types):
 *   - 'tenant_skipped' — fail-closed at the tenant level (e.g.
 *                        missing customer_code).
 *   - 'pushed'         — normal completion with per-task counters.
 *
 * Throws (caller's top-level try/catch logs + Sentry-captures):
 *   - ForbiddenError  user actor reached this path.
 */
export async function pushTasksForTenant(
  ctx: RequestContext,
  tenantId: Uuid,
  adapter: LastMileAdapter,
): Promise<PushTenantOutcome> {
  assertSystemActor(ctx, "task-push:push_for_tenant");

  const pushLog = log.with({ tenant_id: tenantId, request_id: ctx.requestId });

  // ---------------------------------------------------------------------------
  // Step 1: load tenant config (suitefleet_customer_code)
  // ---------------------------------------------------------------------------
  const config = await withServiceRole(
    `task-push:load_config for tenant ${tenantId}`,
    async (tx) => {
      const rows = await tx.execute<TenantConfigRow>(sqlTag`
        SELECT suitefleet_customer_code
        FROM tenants
        WHERE id = ${tenantId}
      `);
      const row = rows[0];
      if (!row) {
        // Defensive: tenant doesn't exist. Shouldn't happen — the
        // cron's tenant enumeration is the source. Surface as a
        // validation error to the caller (cron logs + Sentry).
        throw new ValidationError(`task-push: tenant ${tenantId} not found`);
      }
      return {
        tenantId,
        suitefleetCustomerCode: row.suitefleet_customer_code,
      } satisfies TenantPushConfig;
    },
  );

  // ---------------------------------------------------------------------------
  // GUARD 1: missing_customer_code (tenant-level fail-closed)
  // ---------------------------------------------------------------------------
  const customerCode = config.suitefleetCustomerCode?.trim();
  if (!customerCode) {
    // Count unpushed tasks for the metadata. Single COUNT query,
    // separate from the listUnpushedTasksByTenant call (which we
    // skip entirely on this path).
    const skippedTaskCount = await withServiceRole(
      `task-push:count_unpushed for tenant ${tenantId}`,
      async (tx) => {
        type CountRow = { n: number } & Record<string, unknown>;
        const rows = await tx.execute<CountRow>(sqlTag`
          SELECT count(*)::int AS n
          FROM tasks
          WHERE tenant_id = ${tenantId}
            AND pushed_to_external_at IS NULL
        `);
        return rows[0]?.n ?? 0;
      },
    );

    pushLog.warn(
      { skipped_task_count: skippedTaskCount, reason: "missing_customer_code" },
      "task-push tenant_skipped — suitefleet_customer_code is null/empty",
    );

    await emit({
      eventType: "tenant.push_skipped",
      actorKind: ctx.actor.kind,
      actorId: actorIdFor(ctx.actor),
      tenantId,
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: {
        tenant_id: tenantId,
        reason: "missing_customer_code",
        skipped_task_count: skippedTaskCount,
      },
      requestId: ctx.requestId,
    });

    return {
      kind: "tenant_skipped",
      tenantId,
      reason: "missing_customer_code",
      skippedTaskCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 2: list unpushed tasks
  // ---------------------------------------------------------------------------
  const tasks = await withServiceRole(
    `task-push:list_unpushed for tenant ${tenantId}`,
    async (tx) => listUnpushedTasksByTenant(tx, tenantId),
  );

  if (tasks.length === 0) {
    pushLog.info({}, "task-push no unpushed tasks for tenant");
    return {
      kind: "pushed",
      tenantId,
      attemptedCount: 0,
      succeeded: 0,
      failedToDLQ: 0,
      skippedDistrict: 0,
      awbExists: 0,
      awbExistsReconciled: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 3: authenticate once per tenant (token cached in adapter)
  // ---------------------------------------------------------------------------
  const session = await adapter.authenticate(tenantId);

  // ---------------------------------------------------------------------------
  // Step 4: per-task push loop with 5 req/sec throttle
  // ---------------------------------------------------------------------------
  let succeeded = 0;
  let failedToDLQ = 0;
  let skippedDistrict = 0;
  let awbExists = 0;
  let awbExistsReconciled = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskLog = pushLog.with({ task_id: task.id });

    // Per-task consignee fetch (N+1 — fine at pilot scale, optimise
    // to a JOIN if 7K-tasks/night becomes the bottleneck).
    const consignee = await withServiceRole(
      `task-push:load_consignee for task ${task.id}`,
      async (tx) => {
        const rows = await tx.execute<ConsigneeRow>(sqlTag`
          SELECT id, name, phone, email, address_line, emirate_or_region, district
          FROM consignees
          WHERE id = ${task.consigneeId}
        `);
        const row = rows[0];
        if (!row) {
          throw new ValidationError(
            `task-push: consignee ${task.consigneeId} not found for task ${task.id}`,
          );
        }
        return {
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          addressLine: row.address_line,
          emirateOrRegion: row.emirate_or_region,
          district: row.district,
        } satisfies ConsigneePushSnapshot;
      },
    );

    // -------------------------------------------------------------------------
    // GUARD 2: unknown_district (per-task fail-closed)
    // -------------------------------------------------------------------------
    if (consignee.district === UNKNOWN_DISTRICT_SENTINEL) {
      taskLog.warn(
        { reason: "unknown_district", consignee_id: consignee.id },
        "task-push skipping task — consignee.district is the UNKNOWN sentinel",
      );
      try {
        await recordFailedPushAttempt(ctx, {
          taskId: task.id,
          taskPayload: { skipped_pre_flight: true, reason: "unknown_district" },
          failureReason: "unknown",
          failureDetail: `unknown_district: consignee ${consignee.id} (${consignee.name}) carries the 'UNKNOWN' district sentinel — not pushable until backfilled (see D8-2 migration)`,
        });
      } catch (err) {
        // Audit-side or DB-side failure on the DLQ write. Log + Sentry,
        // continue — we don't want to block the rest of the batch on
        // a telemetry failure.
        captureException(err, {
          component: "task_push_service",
          operation: "guard_unknown_district_dlq_write",
          tenant_id: tenantId,
          task_id: task.id,
        });
      }
      skippedDistrict++;
      // Note: still throttle — the next iteration may make a real
      // SF call, and pacing the loop simplifies the rate-limit math.
      if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
      continue;
    }

    // -------------------------------------------------------------------------
    // Build payload + push
    // -------------------------------------------------------------------------
    // customer_code is captured here for the wire body via the
    // adapter's downstream resolver. The buildTaskCreateRequest helper
    // doesn't carry customer_code today (it goes through the credential
    // resolver path inside last-mile-adapter-factory). The factory
    // resolves customerId (numeric) per-tenant; the new
    // suitefleet_customer_code (string) lookup that the wire shape
    // needs lands when D8-4b's reconcile path finalises the customer
    // block — for D8-4a, customerCode is captured for forensic logs
    // and to demonstrate the guard worked.
    const request = buildTaskCreateRequest(tenantId, task, consignee);

    let pushResult;
    try {
      // Cast bridges the cron-path Omit<...,'shipFrom'> shape to the
      // public TaskCreateRequest contract. buildSuiteFleetTaskBody's
      // conditional shipFrom spread handles the runtime-undefined
      // case. See header `shipFrom posture` for the full rationale.
      pushResult = await adapter.createTask(session, request as TaskCreateRequest);
    } catch (err) {
      // ---------------------------------------------------------------------
      // D8-4b: AWB-exists reconcile branch
      // ---------------------------------------------------------------------
      // SF returned 23505/AWB-exists. Try to close the loop by GETting
      // the existing SF task by AWB and marking the local row pushed
      // with the recovered SF id.
      if (err instanceof SuiteFleetAwbExistsError) {
        const reconcileLog = taskLog.with({ awb: err.awb });
        let reconcileResult;
        try {
          reconcileResult = await adapter.getTaskByAwb(session, err.awb);
        } catch (reconcileErr) {
          const classified = classifyReconcileError(err.awb, reconcileErr);
          reconcileLog.warn(
            {
              failure_reason: classified.reason,
              http_status: classified.httpStatus,
            },
            "task-push AWB-exists reconcile failed — recording to DLQ",
          );
          try {
            await recordFailedPushAttempt(ctx, {
              taskId: task.id,
              taskPayload: request as unknown as Record<string, unknown>,
              failureReason: classified.reason,
              failureDetail: classified.detail,
              httpStatus: classified.httpStatus,
            });
          } catch (dlqErr) {
            captureException(dlqErr, {
              component: "task_push_service",
              operation: "dlq_write_reconcile_failed",
              tenant_id: tenantId,
              task_id: task.id,
              awb: err.awb,
            });
          }
          // Reconcile failure counts as awbExists per reviewer-locked
          // counter posture (two counters, not three — see
          // PushTenantOutcome jsdoc).
          awbExists++;
          if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
          continue;
        }

        // Reconcile success: mark task pushed with the recovered SF id;
        // tracking_number = the AWB itself (we already have it).
        let priorFailedPushResolved = false;
        try {
          await withServiceRole(
            `task-push:mark_pushed_via_reconcile for task ${task.id}`,
            async (tx) =>
              markTaskPushed(tx, tenantId, task.id, reconcileResult.externalId, err.awb),
          );
          // Idempotent — null when no unresolved DLQ row existed.
          // The boolean lands in the audit metadata so operators can
          // trace which reconciles closed out a prior parse-only-era
          // DLQ entry vs first-time AWB-exists with no DLQ history.
          const resolved = await markFailedPushResolved(
            ctx,
            task.id,
            "reconciled-via-awb-D8-4b",
          );
          priorFailedPushResolved = resolved !== null;
        } catch (markErr) {
          // Local-side write failed AFTER SF confirmed the task
          // exists. The task is still unpushed locally; the next cron
          // pass will re-attempt and hit AWB-exists again. Sentry
          // loud — manual investigation needed (DB write failure on
          // the reconcile path is a different shape from the
          // post-create local write failure handled below).
          captureException(markErr, {
            component: "task_push_service",
            operation: "mark_pushed_via_reconcile",
            tenant_id: tenantId,
            task_id: task.id,
            awb: err.awb,
            external_id: reconcileResult.externalId,
          });
          awbExists++;
          if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
          continue;
        }

        await emit({
          eventType: "task.pushed_via_reconcile",
          actorKind: ctx.actor.kind,
          actorId: actorIdFor(ctx.actor),
          tenantId,
          resourceType: "task",
          resourceId: task.id,
          metadata: {
            task_id: task.id,
            external_id: reconcileResult.externalId,
            awb: err.awb,
            customer_order_number: request.customerOrderNumber,
            prior_failed_push_resolved: priorFailedPushResolved,
          },
          requestId: ctx.requestId,
        });

        reconcileLog.info(
          {
            external_id: reconcileResult.externalId,
            prior_failed_push_resolved: priorFailedPushResolved,
          },
          "task-push AWB-exists reconcile ok",
        );
        awbExistsReconciled++;
        if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
        continue;
      }

      // ---------------------------------------------------------------------
      // Non-AWB push failure — classified DLQ write
      // ---------------------------------------------------------------------
      const classified = classifyAdapterError(err);

      taskLog.warn(
        {
          failure_reason: classified.reason,
          http_status: classified.httpStatus,
        },
        "task-push createTask failed — recording to DLQ",
      );

      try {
        await recordFailedPushAttempt(ctx, {
          taskId: task.id,
          taskPayload: request as unknown as Record<string, unknown>,
          failureReason: classified.reason,
          failureDetail: classified.detail,
          httpStatus: classified.httpStatus,
        });
      } catch (dlqErr) {
        captureException(dlqErr, {
          component: "task_push_service",
          operation: "dlq_write",
          tenant_id: tenantId,
          task_id: task.id,
          original_error: classified.detail.slice(0, 200),
        });
      }

      failedToDLQ++;

      if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
      continue;
    }

    // -------------------------------------------------------------------------
    // Success: mark task pushed
    // -------------------------------------------------------------------------
    try {
      await withServiceRole(
        `task-push:mark_pushed for task ${task.id}`,
        async (tx) =>
          markTaskPushed(
            tx,
            tenantId,
            task.id,
            pushResult.externalId,
            pushResult.trackingNumber,
          ),
      );
      succeeded++;
      taskLog.info(
        {
          external_id: pushResult.externalId,
          tracking_number: pushResult.trackingNumber,
        },
        "task-push createTask ok",
      );
    } catch (err) {
      // SF accepted but our local UPDATE failed. The task still has
      // the SF id we just wrote in pushResult; the next cron pass
      // will see it as unpushed and re-attempt — duplicate physical
      // delivery risk. Sentry-capture loud.
      captureException(err, {
        component: "task_push_service",
        operation: "mark_pushed_after_sf_success",
        tenant_id: tenantId,
        task_id: task.id,
        external_id: pushResult.externalId,
      });
      // Count as DLQ-failed for the outcome — operator needs to know.
      failedToDLQ++;
    }

    if (i < tasks.length - 1) await sleep(SF_THROTTLE_MS);
  }

  pushLog.info(
    {
      attempted: tasks.length,
      succeeded,
      failed_to_dlq: failedToDLQ,
      skipped_district: skippedDistrict,
      awb_exists: awbExists,
      awb_exists_reconciled: awbExistsReconciled,
    },
    "task-push tenant pass complete",
  );

  return {
    kind: "pushed",
    tenantId,
    attemptedCount: tasks.length,
    succeeded,
    failedToDLQ,
    skippedDistrict,
    awbExists,
    awbExistsReconciled,
  };
}

// =============================================================================
// pushSingleTask — Day 8 / D8-5
// =============================================================================
// Single-task variant of the cron's per-iteration push logic. Reused by the
// operator-driven DLQ retry path (failed-pushes/service.ts retryFailedPush).
//
// Mirrors the cron loop's per-task body:
//   1. Load tenant config; fail-closed on missing customer_code.
//   2. Load task; reject if not found or already pushed.
//   3. Load consignee; pre-flight unknown_district guard.
//   4. Authenticate, build payload, push.
//   5. AWB-exists reconcile branch (mirror D8-4b).
//   6. Success: markTaskPushed + (if from DLQ retry) markFailedPushResolved.
//   7. Failure: recordFailedPushAttempt (with the load-bearing
//      `awb_exists_reconcile_failed:` prefix on reconcile failures).
//
// What pushSingleTask does NOT do (intentional):
//   - Throttle. Single-task = no inter-task pacing. Bulk retry from
//     the admin UI throttles client-side at 5 req/sec by awaiting
//     each route call with a 200ms delay between dispatches.
//   - Emit `tenant.push_skipped`. That event is for the cron's
//     bulk-pass scope; for single-task retries, the operator-layer
//     `failed_push.retried` event carries the outcome.
// =============================================================================

/**
 * Push one task to the last-mile adapter, returning a typed outcome
 * the caller can branch on. System-actor-only (mirrors the cron's
 * per-task primitives — recordFailedPushAttempt, markFailedPushResolved
 * — which are all system-only).
 *
 * The retry path in failed-pushes/service.ts builds a synthetic
 * `system:dlq_retry` actor before calling here; the user-attributed
 * `failed_push.retried` event is emitted at THAT layer, not this one.
 *
 * Throws:
 *   - ForbiddenError       user actor reached this path (routing bug).
 *   - ValidationError      missing tenant context, or DB-level
 *                          inconsistency (e.g. consignee row missing
 *                          for an existing task).
 */
export async function pushSingleTask(
  ctx: RequestContext,
  taskId: Uuid,
  adapter: LastMileAdapter,
): Promise<SinglePushOutcome> {
  assertSystemActor(ctx, "task-push:push_single_task");
  if (!ctx.tenantId) {
    throw new ValidationError("task-push:push_single_task requires a tenant context");
  }
  const tenantId = ctx.tenantId;
  const taskLog = log.with({
    tenant_id: tenantId,
    task_id: taskId,
    request_id: ctx.requestId,
    component_op: "push_single_task",
  });

  // ---------------------------------------------------------------------------
  // Step 1: tenant config + customer_code guard
  // ---------------------------------------------------------------------------
  const config = await withServiceRole(
    `task-push:single load_config for tenant ${tenantId}`,
    async (tx) => {
      const rows = await tx.execute<TenantConfigRow>(sqlTag`
        SELECT suitefleet_customer_code
        FROM tenants
        WHERE id = ${tenantId}
      `);
      const row = rows[0];
      if (!row) {
        throw new ValidationError(
          `task-push:push_single_task tenant ${tenantId} not found`,
        );
      }
      return {
        tenantId,
        suitefleetCustomerCode: row.suitefleet_customer_code,
      } satisfies TenantPushConfig;
    },
  );
  const customerCode = config.suitefleetCustomerCode?.trim();
  if (!customerCode) {
    taskLog.warn(
      { reason: "missing_customer_code" },
      "push_single_task tenant_skipped — customer_code missing",
    );
    return { kind: "tenant_skipped", reason: "missing_customer_code" };
  }

  // ---------------------------------------------------------------------------
  // Step 2: load task; reject if not found or already pushed
  // ---------------------------------------------------------------------------
  const task = await withServiceRole(
    `task-push:single load_task ${taskId}`,
    async (tx) => findTaskById(tx, taskId),
  );
  if (!task || task.tenantId !== tenantId) {
    taskLog.warn({}, "push_single_task task_not_found (cross-tenant or missing)");
    return { kind: "task_not_found" };
  }
  if (task.pushedToExternalAt !== null && task.externalId !== null) {
    taskLog.info(
      { external_id: task.externalId },
      "push_single_task task_already_pushed — idempotent no-op",
    );
    return { kind: "task_already_pushed", externalId: task.externalId };
  }

  // ---------------------------------------------------------------------------
  // Step 3: load consignee + unknown_district guard
  // ---------------------------------------------------------------------------
  const consignee = await withServiceRole(
    `task-push:single load_consignee for task ${task.id}`,
    async (tx) => {
      const rows = await tx.execute<ConsigneeRow>(sqlTag`
        SELECT id, name, phone, email, address_line, emirate_or_region, district
        FROM consignees
        WHERE id = ${task.consigneeId}
      `);
      const row = rows[0];
      if (!row) {
        throw new ValidationError(
          `task-push:push_single_task consignee ${task.consigneeId} not found for task ${task.id}`,
        );
      }
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        email: row.email,
        addressLine: row.address_line,
        emirateOrRegion: row.emirate_or_region,
        district: row.district,
      } satisfies ConsigneePushSnapshot;
    },
  );
  if (consignee.district === UNKNOWN_DISTRICT_SENTINEL) {
    taskLog.warn(
      { reason: "unknown_district", consignee_id: consignee.id },
      "push_single_task skipping — consignee.district is the UNKNOWN sentinel",
    );
    try {
      await recordFailedPushAttempt(ctx, {
        taskId: task.id,
        taskPayload: { skipped_pre_flight: true, reason: "unknown_district" },
        failureReason: "unknown",
        failureDetail: `unknown_district: consignee ${consignee.id} (${consignee.name}) carries the 'UNKNOWN' district sentinel — not pushable until backfilled (see D8-2 migration)`,
      });
    } catch (err) {
      captureException(err, {
        component: "task_push_service",
        operation: "single_task_unknown_district_dlq_write",
        tenant_id: tenantId,
        task_id: task.id,
      });
    }
    return { kind: "skipped_district", district: consignee.district };
  }

  // ---------------------------------------------------------------------------
  // Step 4: authenticate + push
  // ---------------------------------------------------------------------------
  const session = await adapter.authenticate(tenantId);
  const request = buildTaskCreateRequest(tenantId, task, consignee);

  let pushResult;
  try {
    pushResult = await adapter.createTask(session, request as TaskCreateRequest);
  } catch (err) {
    // ---------------------------------------------------------------------
    // D8-4b reconcile branch (mirror of pushTasksForTenant)
    // ---------------------------------------------------------------------
    if (err instanceof SuiteFleetAwbExistsError) {
      const reconcileLog = taskLog.with({ awb: err.awb });
      let reconcileResult;
      try {
        reconcileResult = await adapter.getTaskByAwb(session, err.awb);
      } catch (reconcileErr) {
        const classified = classifyReconcileError(err.awb, reconcileErr);
        reconcileLog.warn(
          {
            failure_reason: classified.reason,
            http_status: classified.httpStatus,
          },
          "push_single_task AWB-exists reconcile failed — recording to DLQ",
        );
        try {
          await recordFailedPushAttempt(ctx, {
            taskId: task.id,
            taskPayload: request as unknown as Record<string, unknown>,
            failureReason: classified.reason,
            failureDetail: classified.detail,
            httpStatus: classified.httpStatus,
          });
        } catch (dlqErr) {
          captureException(dlqErr, {
            component: "task_push_service",
            operation: "single_dlq_write_reconcile_failed",
            tenant_id: tenantId,
            task_id: task.id,
            awb: err.awb,
          });
        }
        return {
          kind: "awb_exists",
          awb: err.awb,
          reconcileErrorMessage: classified.detail,
        };
      }
      // Reconcile success
      let priorFailedPushResolved = false;
      try {
        await withServiceRole(
          `task-push:single mark_pushed_via_reconcile for task ${task.id}`,
          async (tx) =>
            markTaskPushed(tx, tenantId, task.id, reconcileResult.externalId, err.awb),
        );
        const resolved = await markFailedPushResolved(
          ctx,
          task.id,
          "reconciled-via-awb-D8-5-retry",
        );
        priorFailedPushResolved = resolved !== null;
      } catch (markErr) {
        // EDGE CASE — D8-4b watch-item:
        // followup_reconcile_recovered_local_write_failure.md
        captureException(markErr, {
          component: "task_push_service",
          operation: "single_mark_pushed_via_reconcile",
          tenant_id: tenantId,
          task_id: task.id,
          awb: err.awb,
          external_id: reconcileResult.externalId,
        });
        return {
          kind: "awb_exists",
          awb: err.awb,
          reconcileErrorMessage: `mark_pushed_via_reconcile failed: ${markErr instanceof Error ? markErr.message : String(markErr)}`,
        };
      }
      await emit({
        eventType: "task.pushed_via_reconcile",
        actorKind: ctx.actor.kind,
        actorId: actorIdFor(ctx.actor),
        tenantId,
        resourceType: "task",
        resourceId: task.id,
        metadata: {
          task_id: task.id,
          external_id: reconcileResult.externalId,
          awb: err.awb,
          customer_order_number: request.customerOrderNumber,
          prior_failed_push_resolved: priorFailedPushResolved,
        },
        requestId: ctx.requestId,
      });
      reconcileLog.info(
        {
          external_id: reconcileResult.externalId,
          prior_failed_push_resolved: priorFailedPushResolved,
        },
        "push_single_task AWB-exists reconcile ok",
      );
      return {
        kind: "awb_reconciled",
        externalId: reconcileResult.externalId,
        awb: err.awb,
        priorFailedPushResolved,
      };
    }

    // ---------------------------------------------------------------------
    // Non-AWB push failure → DLQ
    // ---------------------------------------------------------------------
    const classified = classifyAdapterError(err);
    taskLog.warn(
      {
        failure_reason: classified.reason,
        http_status: classified.httpStatus,
      },
      "push_single_task createTask failed — recording to DLQ",
    );
    try {
      await recordFailedPushAttempt(ctx, {
        taskId: task.id,
        taskPayload: request as unknown as Record<string, unknown>,
        failureReason: classified.reason,
        failureDetail: classified.detail,
        httpStatus: classified.httpStatus,
      });
    } catch (dlqErr) {
      captureException(dlqErr, {
        component: "task_push_service",
        operation: "single_dlq_write",
        tenant_id: tenantId,
        task_id: task.id,
        original_error: classified.detail.slice(0, 200),
      });
    }
    return {
      kind: "failed_to_dlq",
      failureReason: classified.reason,
      httpStatus: classified.httpStatus,
      failureDetail: classified.detail,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 5: success — mark task pushed; idempotent close-out of any stale
  //          failed_pushes row (covers the operator clicking retry on a
  //          row whose task was already marked pushed in a parallel cron
  //          pass — markFailedPushResolved is no-op if no unresolved row)
  // ---------------------------------------------------------------------------
  try {
    await withServiceRole(
      `task-push:single mark_pushed for task ${task.id}`,
      async (tx) =>
        markTaskPushed(
          tx,
          tenantId,
          task.id,
          pushResult.externalId,
          pushResult.trackingNumber,
        ),
    );
    // Close out any unresolved DLQ row left from a prior failure;
    // idempotent (returns null if there was none).
    await markFailedPushResolved(ctx, task.id, "resolved-via-D8-5-retry-success");
  } catch (err) {
    // SF accepted but local UPDATE failed. Same Sentry-loud posture as
    // the cron loop's success path. The next cron pass will see
    // pushed_to_external_at IS NULL and re-attempt — duplicate-physical-
    // delivery risk worth waking ops up for.
    captureException(err, {
      component: "task_push_service",
      operation: "single_mark_pushed_after_sf_success",
      tenant_id: tenantId,
      task_id: task.id,
      external_id: pushResult.externalId,
    });
    return {
      kind: "failed_to_dlq",
      failureReason: "unknown",
      failureDetail: `mark_pushed_after_sf_success failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  taskLog.info(
    {
      external_id: pushResult.externalId,
      tracking_number: pushResult.trackingNumber,
    },
    "push_single_task createTask ok",
  );
  return {
    kind: "succeeded",
    externalId: pushResult.externalId,
    trackingNumber: pushResult.trackingNumber,
  };
}
