// POST /api/failed-pushes/bulk-resolve   failed_pushes:resolve → failed_push.bulk_resolved
//
// Day-33 PR-D (Plan #317 §3.7 CLEANUP-1, §6 OQ-4 ruling (a)+(b) at SHA f0ef560).
// Operator-driven bulk-resolve for unresolved failed_pushes rows.
//
// Request body shape (JSON):
//   {
//     failedPushIds: string[],   // 1..200 uuids
//     resolutionNotes: string    // 1..500 chars, trimmed
//   }
//
// Returns:
//   200 { resolved: FailedPush[], notFoundIds: string[] }
//   400 ValidationError    empty input, oversize batch, notes empty/too-long, malformed body
//   403 ForbiddenError     caller lacks failed_pushes:resolve (CS Agent, Ops Manager)
//
// Distinct from /api/failed-pushes/[id]/retry — retry tries SF again;
// resolve is "give up without retrying" (operator decision; row closes
// with the operator-provided reason). One audit emit per operation per
// the registered failed_push.bulk_resolved metadata shape; no per-row
// events.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { bulkResolveFailedPushes } from "@/modules/failed-pushes";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime — withServiceRole requires the postgres-js driver
// (mirrors the retry route's runtime declaration).
export const runtime = "nodejs";

// Hard ceilings mirror the service-layer's runtime checks (defence in
// depth — Zod rejects malformed input early; service rejects again on
// trust boundary). Keep the literals in sync; service is the canon.
const BodySchema = z.object({
  failedPushIds: z
    .array(z.string().uuid({ message: "each failed_push_id must be a uuid" }))
    .min(1, { message: "failedPushIds must contain at least one id" })
    .max(200, { message: "failedPushIds may contain at most 200 ids per batch" }),
  resolutionNotes: z
    .string()
    .min(1, { message: "resolutionNotes must be non-empty" })
    .max(500, { message: "resolutionNotes must be ≤500 chars" }),
});

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const rawBody = await req.json().catch(() => {
      throw new ValidationError("request body must be valid JSON");
    });
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new ValidationError(first?.message ?? "invalid request body");
    }

    const ctx = await buildRequestContext("/api/failed-pushes/bulk-resolve", requestId);
    const result = await bulkResolveFailedPushes(ctx, {
      failedPushIds: parsed.data.failedPushIds,
      resolutionNotes: parsed.data.resolutionNotes,
      source: "admin_ui",
    });
    return NextResponse.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
