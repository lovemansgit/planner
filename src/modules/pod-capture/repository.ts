// POD capture repository — SQL against tasks.pod_photo_captures
// (migration 0031). Lives here, not in src/modules/tasks/, per the
// Day-53 EVE module-fence note in types.ts.

import { sql as sqlTag } from "drizzle-orm";

import type { DbTx } from "@/shared/db";
import type { Uuid } from "@/shared/types";

import type { PodCaptureEntry } from "./types";

export type TaskPodStateRow = {
  readonly id: string;
  readonly pod_photos: readonly unknown[] | null;
  readonly pod_photo_captures: readonly PodCaptureEntry[] | null;
} & Record<string, unknown>;

/** SELECT the two POD columns for one task; null when no row. */
export async function readTaskPodState(
  tx: DbTx,
  tenantId: Uuid,
  taskId: Uuid,
): Promise<TaskPodStateRow | null> {
  const rows = await tx.execute<TaskPodStateRow>(sqlTag`
    SELECT id, pod_photos, pod_photo_captures
    FROM tasks
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
    LIMIT 1
  `);
  return rows[0] ?? null;
}

/** Record the full capture-entry array (one write, all-or-nothing). */
export async function recordPodCaptures(
  tx: DbTx,
  tenantId: Uuid,
  taskId: Uuid,
  entries: readonly PodCaptureEntry[],
): Promise<void> {
  await tx.execute(sqlTag`
    UPDATE tasks
    SET pod_photo_captures = ${JSON.stringify(entries)}::jsonb
    WHERE id = ${taskId} AND tenant_id = ${tenantId}
  `);
}

/**
 * Total captured bytes across ALL tenants — the free-tier guardrail
 * input (the 1 GB cap is project-wide, not per-tenant). Cheap at MVP
 * scale; revisit with a counter table if capture volume ever makes
 * this scan visible.
 */
export async function sumCapturedPodBytes(tx: DbTx): Promise<number> {
  const rows = await tx.execute<{ total: string | number | null }>(sqlTag`
    SELECT COALESCE(SUM((entry->>'bytes')::bigint), 0) AS total
    FROM tasks, LATERAL jsonb_array_elements(pod_photo_captures) AS entry
    WHERE pod_photo_captures IS NOT NULL
  `);
  const raw = rows[0]?.total ?? 0;
  return typeof raw === "number" ? raw : Number(raw);
}
