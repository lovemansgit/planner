// POST /api/failed-pushes/:id/retry   failed_pushes:retry → failed_push.retried
//
// Day 8 / D8-5. Operator-driven manual retry of a failed_pushes row.
// Authorisation gated at the service layer via
// `failed_pushes:retry`. Takes NO request body — the id is path-only;
// the retry is the verb.
//
// Success: 200 with `{ failedPush, outcome }` JSON. The `outcome.kind`
// discriminator tells the UI what to render (succeeded /
// awb_reconciled / awb_exists / failed_to_dlq / skipped_district /
// tenant_skipped / task_already_pushed / task_not_found).
//
// Returns:
//   403 ForbiddenError       caller lacks failed_pushes:retry (CS Agent,
//                            Ops Manager — both excluded by design)
//   404 NotFoundError        failed_pushes id not found in tenant
//   400 ValidationError      id not a uuid, or row already resolved
//                            (idempotency guard)
//   502 CredentialError      upstream SF auth/connectivity failure
//
// Bulk multi-select retry from the admin UI: client-side iterates
// IDs and awaits each call sequentially with a 200ms throttle (5
// req/sec — same as the cron's per-task pacing). Server doesn't
// expose a bulk endpoint; each retry is independently audited via
// the failed_push.retried event.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { retryFailedPush } from "@/modules/failed-pushes";
import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import { pushSingleTask } from "@/modules/task-push";
import { buildDemoContext } from "@/shared/demo-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime — withServiceRole + the SF adapter's fetch path require
// the postgres-js driver and Node sockets respectively (mirrors the
// cron route's runtime declaration).
export const runtime = "nodejs";

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    rejectAnyBody(await req.json().catch(() => undefined));

    const ctx = await buildDemoContext(`/api/failed-pushes/${id}/retry`, requestId);
    const adapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });
    // pushSingleTask is injected (not imported by retryFailedPush) so
    // the failed-pushes module doesn't form a cycle with task-push
    // (which already imports failed-pushes for recordFailedPushAttempt
    // + markFailedPushResolved). The route is the orchestration layer
    // that imports both modules.
    const result = await retryFailedPush(ctx, id, adapter, pushSingleTask);
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}

function parseId(raw: string): string {
  const result = IdParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`id must be a uuid, got '${raw}'`);
  }
  return result.data;
}

/**
 * Retry endpoints take no input. Allow an absent body or `{}`; reject
 * anything else (mirrors the lifecycle endpoints' rejectAnyBody pattern
 * — a typo'd body field surfaces as 400 instead of being silently
 * ignored).
 */
function rejectAnyBody(body: unknown): void {
  if (body === undefined) return;
  if (typeof body !== "object" || body === null || Object.keys(body).length > 0) {
    throw new ValidationError("retry endpoint takes no body");
  }
}
