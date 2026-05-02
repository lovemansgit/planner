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
// 23505 / AWB-exists handling (D8-4a parse-only; D8-4b reconciles)
// -----------------------------------------------------------------------------
// On `SuiteFleetAwbExistsError` from the adapter, D8-4a records a
// failed_pushes row with the parsed AWB in failure_detail and
// leaves the task unpushed. The task's `pushed_to_external_at` stays
// NULL, so the next cron pass re-attempts the push, gets another
// AWB-exists, increments attempt_count, etc. — a deliberate gap
// pinned for first-run empirical capture in
// memory/followup_suitefleet_bulk_push_empirical.md.
//
// D8-4b adds the `getTaskByAwb` reconcile path
// (GET /api/tasks/awb/{awb}/task-activities, endpoint confirmed via
// SF API docs reading 4 May 2026, but timeline response shape needs
// the first-run empirical capture before D8-4b commits to a parser).
//
// -----------------------------------------------------------------------------
// shipFrom posture (D8-4a)
// -----------------------------------------------------------------------------
// Per Aqib Group-1 + live webhook capture: SF auto-populates shipFrom
// from the merchant master when the create payload omits it. The
// internal `TaskCreateRequest` contract still requires shipFrom (a
// `DeliveryAddress`); D8-4a passes a synthetic warehouse-shaped
// shipFrom that SF will overwrite anyway. The right architectural
// fix — making shipFrom optional on TaskCreateRequest and
// conditionally spreading in `buildSuiteFleetTaskBody` — is a
// future contract relaxation (parallel to the D8-3 lat/lng pattern);
// out of D8-4a scope to avoid contract churn alongside the cron
// wiring.

import { emit } from "../audit";
import { recordFailedPushAttempt, type FailureReason } from "../failed-pushes";
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

import type { PushTenantOutcome } from "./types";

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
 */
function classifyAdapterError(err: unknown): {
  reason: FailureReason;
  detail: string;
  httpStatus?: number;
} {
  if (err instanceof SuiteFleetAwbExistsError) {
    return {
      reason: "client_4xx",
      detail: `awb_exists: '${err.awb}' (${err.responseBody.slice(0, 200)})`,
      httpStatus: err.httpStatus,
    };
  }
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
 * Map a Task + ConsigneeSnapshot + tenant customer_code into the
 * internal-language `TaskCreateRequest` the adapter expects.
 *
 * Locked defaults (per Aqib Group-1):
 *   - countryCode = 'AE' (UAE pilot)
 *   - paymentMethod = 'PrePaid' (top-level, not nested — D8-3 fix)
 *   - itemQuantity = 1 (single bag per meal-plan delivery)
 *   - codAmount = 0, declaredValue = 0 (prepaid)
 *   - city = consignee.emirate_or_region (one-string-fits-both for
 *     UAE pilot per option-1 lean in the C-3 deferred memo)
 *   - shipFrom = synthetic warehouse-shaped placeholder (SF auto-
 *     populates from merchant master; what we send is overwritten)
 */
function buildTaskCreateRequest(
  tenantId: Uuid,
  task: Task,
  consignee: ConsigneePushSnapshot,
): TaskCreateRequest {
  const consigneeAddress: DeliveryAddress = {
    addressLine1: consignee.addressLine,
    city: consignee.emirateOrRegion,
    district: consignee.district,
    countryCode: "AE",
  };
  const shipFrom: DeliveryAddress = {
    // SF overwrites this from merchant master. Kept as a synthetic
    // placeholder until the contract is relaxed to allow optional
    // shipFrom (out of D8-4a scope).
    addressLine1: "Transcorp Warehouse — auto-populated by SF from merchant master",
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
    shipFrom,
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
      pushResult = await adapter.createTask(session, request);
    } catch (err) {
      const classified = classifyAdapterError(err);
      const isAwbExists = err instanceof SuiteFleetAwbExistsError;

      taskLog.warn(
        {
          failure_reason: classified.reason,
          http_status: classified.httpStatus,
          awb_exists: isAwbExists,
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

      if (isAwbExists) {
        awbExists++;
      } else {
        failedToDLQ++;
      }

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
  };
}
