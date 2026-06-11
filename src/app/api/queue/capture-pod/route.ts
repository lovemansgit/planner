// Day-53 EVE — QStash consumer for POD photo capture (cleared #413
// lane; plan memory/plans/day-53-durable-pod-photo-storage.md §4.1).
// Mirrors /api/queue/cancel-task conventions: signature-gated, decodes
// the payload, runs the service, 200 on every handled outcome so QStash
// doesn't retry no-ops; throws (→ 500) on capture failure so QStash
// retries and ultimately routes to /api/queue/capture-pod-failed.

import "server-only";

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextResponse } from "next/server";

import {
  capturePodPhotosForTask,
  createSupabasePodObjectStore,
} from "@/modules/pod-capture";
import type { CapturePodPayload } from "@/modules/pod-capture";
import { logger } from "@/shared/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const log = logger.with({ component: "queue_capture_pod" });

export const POST = verifySignatureAppRouter(async (request: Request) => {
  let payload: CapturePodPayload;
  try {
    payload = (await request.json()) as CapturePodPayload;
  } catch (err) {
    log.error(
      { error: err instanceof Error ? err.message : String(err) },
      "capture-pod: payload parse failed",
    );
    return new Response(null, { status: 400 });
  }
  if (!payload?.tenant_id || !payload?.task_id) {
    log.error({ payload }, "capture-pod: payload missing identifiers");
    return new Response(null, { status: 400 });
  }

  const store = createSupabasePodObjectStore({ fetch: globalThis.fetch });
  const result = await capturePodPhotosForTask(payload, {
    store,
    fetch: globalThis.fetch,
  });

  return NextResponse.json(result, { status: 200 });
});
