// POD capture service — copy SF's 7-day-TTL POD photos into the
// private bucket (capture leg) and serve captured bytes to the POD
// proxy route (read leg).
//
// Day-53 EVE lane (plan memory/plans/day-53-durable-pod-photo-storage.md
// §4, cleared #413 on Love's free-tier ruling). Free-tier guardrail per
// the dispatch: log-and-alert as usage approaches the 1 GB cap — NEVER
// a silent drop. Capture always completes; the alert is the signal that
// the GTM-precondition Pro upgrade
// (memory/followup_gtm_supabase_pro_upgrade.md) is becoming urgent.

import { logger } from "@/shared/logger";
import { captureException } from "@/shared/sentry-capture";
import { withServiceRole, withTenant } from "@/shared/db";
import { ForbiddenError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";
import type { Uuid } from "@/shared/types";

import { requirePermission } from "../identity";

import {
  readTaskPodState,
  readTaskPodStateCrossTenant,
  recordPodCaptures,
  sumCapturedPodBytes,
} from "./repository";
import type {
  CapturePodOutcome,
  CapturePodPayload,
  PodCaptureEntry,
  PodObjectStore,
} from "./types";

const log = logger.with({ component: "pod_capture_service" });

// Free-tier guardrail thresholds (Supabase free plan = 1 GB storage).
const FREE_TIER_BYTES = 1024 * 1024 * 1024;
const APPROACHING_RATIO = 0.8;
const CRITICAL_RATIO = 0.95;

export type FreeTierUsageClass = "ok" | "approaching" | "critical";

/** Pure threshold classifier — exported for unit/integration pinning. */
export function classifyFreeTierUsage(totalBytes: number): FreeTierUsageClass {
  if (totalBytes >= FREE_TIER_BYTES * CRITICAL_RATIO) return "critical";
  if (totalBytes >= FREE_TIER_BYTES * APPROACHING_RATIO) return "approaching";
  return "ok";
}

export interface CapturePodDeps {
  readonly store: PodObjectStore;
  readonly fetch: typeof globalThis.fetch;
}

/**
 * Map a content type to the stored extension. Unknown image types
 * store as .img — the content_type entry field is authoritative on
 * the read side; the extension is for bucket-browsing ergonomics only.
 */
function extensionFor(contentType: string): string {
  if (contentType.includes("image/jpeg") || contentType.includes("image/jpg")) return "jpg";
  if (contentType.includes("image/png")) return "png";
  if (contentType.includes("image/webp")) return "webp";
  if (contentType.includes("image/heic")) return "heic";
  return "img";
}

/**
 * pod_photos entries are stored verbatim from the SF wire (plan §4.4
 * Option A: strings observed; jsonb tolerates richer shapes). Extract
 * a fetchable URL from either a plain string or an object with a
 * url-ish field; null = unfetchable entry (capture fails loud).
 */
function photoUrlOf(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && entry !== null) {
    const o = entry as Record<string, unknown>;
    const candidate = o.url ?? o.photoUrl ?? o.href;
    if (typeof candidate === "string") return candidate;
  }
  return null;
}

/**
 * Capture every pod_photos URL for one task into the bucket and record
 * the index-aligned entries. Idempotent (already-captured = no-op).
 * Throws on any upstream/store failure with NOTHING partial recorded —
 * the QStash retry policy and the capture-pod-failed DLQ twin own
 * failures; a retry re-fetches everything (uploads are upsert-safe).
 */
export async function capturePodPhotosForTask(
  payload: CapturePodPayload,
  deps: CapturePodDeps,
): Promise<CapturePodOutcome> {
  const tenantId = payload.tenant_id;
  const taskId = payload.task_id;
  const taskLog = log.with({
    operation: "capture_pod_photos",
    tenant_id: tenantId,
    task_id: taskId,
    correlation_id: payload.correlation_id,
  });

  const state = await withTenant(tenantId, async (tx) =>
    readTaskPodState(tx, tenantId, taskId),
  );
  if (state === null) {
    taskLog.warn({ error_code: "task_not_found" });
    return { outcome: "task_not_found" };
  }
  if (state.pod_photo_captures !== null && state.pod_photo_captures.length > 0) {
    taskLog.info({ outcome: "already_captured" });
    return { outcome: "already_captured" };
  }
  if (state.pod_photos === null || state.pod_photos.length === 0) {
    taskLog.info({ outcome: "no_photos" });
    return { outcome: "no_photos" };
  }

  await deps.store.ensureBucket();

  // Fetch + store every photo BEFORE any DB write — a mid-list failure
  // throws and records nothing, so the retry path re-runs the whole
  // list (upsert-safe) instead of resuming a half-recorded state.
  const entries: PodCaptureEntry[] = [];
  for (let index = 0; index < state.pod_photos.length; index++) {
    const url = photoUrlOf(state.pod_photos[index]);
    if (url === null) {
      throw new Error(
        `pod capture: pod_photos[${index}] has no extractable url for task ${taskId}`,
      );
    }
    const upstream = await deps.fetch(url, { redirect: "follow" });
    if (!upstream.ok) {
      throw new Error(
        `pod capture: upstream ${upstream.status} for pod_photos[${index}] of task ${taskId}`,
      );
    }
    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    const bytes = await upstream.arrayBuffer();
    const path = `${tenantId}/${taskId}/${index}.${extensionFor(contentType)}`;
    await deps.store.put(path, bytes, contentType);
    entries.push({ path, bytes: bytes.byteLength, content_type: contentType });
  }

  await withTenant(tenantId, async (tx) =>
    recordPodCaptures(tx, tenantId, taskId, entries),
  );

  const totalBytes = entries.reduce((acc, e) => acc + e.bytes, 0);
  taskLog.info({
    outcome: "captured",
    captured_count: entries.length,
    total_bytes: totalBytes,
  });

  // Free-tier guardrail — log-and-alert, NEVER a drop. Failures here
  // must not fail the (already successful) capture.
  try {
    const projectTotal = await withServiceRole("pod-capture guardrail sum", async (tx) =>
      sumCapturedPodBytes(tx),
    );
    const usage = classifyFreeTierUsage(projectTotal);
    if (usage === "approaching") {
      log.warn({
        operation: "free_tier_guardrail",
        usage_class: usage,
        total_bytes: projectTotal,
        cap_bytes: FREE_TIER_BYTES,
      });
    } else if (usage === "critical") {
      log.error({
        operation: "free_tier_guardrail",
        usage_class: usage,
        total_bytes: projectTotal,
        cap_bytes: FREE_TIER_BYTES,
      });
      captureException(
        new Error(
          `POD storage at ${(projectTotal / FREE_TIER_BYTES * 100).toFixed(1)}% of the Supabase free-tier 1 GB cap — the GTM-precondition Pro upgrade (memory/followup_gtm_supabase_pro_upgrade.md) is now urgent`,
        ),
        { component: "pod_capture_service", operation: "free_tier_guardrail" },
      );
    }
  } catch (guardErr) {
    log.warn({
      operation: "free_tier_guardrail",
      error_code: "sum_failed",
      message: guardErr instanceof Error ? guardErr.message : String(guardErr),
    });
  }

  return { outcome: "captured", capturedCount: entries.length, totalBytes };
}

/**
 * Read leg for the POD proxy route: the captured bytes for one photo
 * index, or null when nothing was captured (the route falls back to
 * the vendor URL). Same task:read gate as getPodPhotoSourceUrl — the
 * browser-facing contract is unchanged.
 */
export async function getCapturedPodPhoto(
  ctx: RequestContext,
  taskId: Uuid,
  photoIndex: number,
  deps: { readonly store: PodObjectStore },
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  requirePermission(ctx, "task:read");
  if (!ctx.tenantId) {
    throw new ForbiddenError("pod capture read requires a tenant context");
  }
  const tenantId = ctx.tenantId;

  const state = await withTenant(tenantId, async (tx) =>
    readTaskPodState(tx, tenantId, taskId),
  );
  const entry = state?.pod_photo_captures?.[photoIndex];
  if (!entry) return null;

  const object = await deps.store.get(entry.path);
  if (object === null) {
    // Recorded entry but missing object — storage drift. Loud signal;
    // the route falls back to the vendor URL (may still be in TTL).
    log.warn({
      operation: "get_captured_pod_photo",
      error_code: "object_missing_for_entry",
      tenant_id: tenantId,
      task_id: taskId,
      photo_index: photoIndex,
      path: entry.path,
    });
    return null;
  }
  return { bytes: object.bytes, contentType: entry.content_type || object.contentType };
}

/**
 * Cross-tenant read leg for the Transcorp-admin POD proxy
 * (/api/admin/tasks/[id]/pod/[index]). Same shape as getCapturedPodPhoto but
 * gated on `task:read_all` (the same boundary `listAllTasks` trusts for
 * cross-tenant task data) and reads under `withServiceRole` so an admin can
 * view any merchant's captured POD. No `assertTenantScoped` — admins are
 * deliberately cross-tenant. See memory/followup_admin_pod_proxy_cross_tenant.md.
 */
export async function getCapturedPodPhotoForAdmin(
  ctx: RequestContext,
  taskId: Uuid,
  photoIndex: number,
  deps: { readonly store: PodObjectStore },
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  requirePermission(ctx, "task:read_all");

  const state = await withServiceRole(
    "transcorp_staff:get_captured_pod_photo",
    async (tx) => readTaskPodStateCrossTenant(tx, taskId),
  );
  const entry = state?.pod_photo_captures?.[photoIndex];
  if (!entry) return null;

  const object = await deps.store.get(entry.path);
  if (object === null) {
    // Recorded entry but missing object — storage drift. Loud signal;
    // the route falls back to the vendor URL (may still be in TTL).
    log.warn({
      operation: "get_captured_pod_photo_admin",
      error_code: "object_missing_for_entry",
      task_id: taskId,
      photo_index: photoIndex,
      path: entry.path,
    });
    return null;
  }
  return { bytes: object.bytes, contentType: entry.content_type || object.contentType };
}
