// POD capture module — domain types.
//
// Day-53 EVE durable-POD lane (plan
// memory/plans/day-53-durable-pod-photo-storage.md §4, cleared #413 on
// Love's free-tier ruling). This module owns copying SF's 7-day-TTL POD
// photos into Planner's private Supabase Storage bucket and serving the
// captured bytes back through the POD proxy route. It deliberately
// lives OUTSIDE src/modules/tasks/ — Session B holds that module's
// fence during R6; the only tasks-table touch is SQL in this module's
// repository (the `pod_photo_captures` column from migration 0031).

import type { Uuid } from "@/shared/types";

/** QStash message body for /api/queue/capture-pod. */
export interface CapturePodPayload {
  readonly tenant_id: Uuid;
  readonly task_id: Uuid;
  /**
   * Traceability only (webhook_events id of the triggering DELIVERED
   * event). Drives the QStash deduplicationId so one delivery event
   * captures once; never reaches SF.
   */
  readonly correlation_id: string;
}

/**
 * One captured photo, index-aligned with tasks.pod_photos. `path` is
 * relative to the private bucket; `bytes` feeds the free-tier guardrail
 * SUM (migration 0031 column comment).
 */
export interface PodCaptureEntry {
  readonly path: string;
  readonly bytes: number;
  readonly content_type: string;
}

export type CapturePodOutcome =
  | { readonly outcome: "captured"; readonly capturedCount: number; readonly totalBytes: number }
  | { readonly outcome: "already_captured" }
  | { readonly outcome: "no_photos" }
  | { readonly outcome: "task_not_found" };

/**
 * Object-store boundary — injected so tests never touch the network
 * and a future provider swap (e.g. R2) stays a one-file change
 * (CLAUDE.md: wrap external dependencies behind abstract interfaces).
 */
export interface PodObjectStore {
  /** Idempotent: creating an already-existing bucket is a no-op. */
  ensureBucket(): Promise<void>;
  put(path: string, bytes: ArrayBuffer, contentType: string): Promise<void>;
  get(path: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null>;
}
