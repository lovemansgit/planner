// POST /api/subscriptions/:id/resume   subscription:resume → subscription.resumed
//
// Day-16 Block 4-C — manual operator resume per brief §3.1.7. Body
// shape: `{ idempotency_key }`. Auto-resume from cron is internal —
// `/api/cron/auto-resume` calls the service directly with
// `is_auto_resume: true`; that path does NOT route through this
// endpoint.
//
// Success:
//   - 200 with ResumeSubscriptionResult JSON. status field
//     discriminates 'resumed' vs 'already_active' (idempotent replay).
//
// Errors:
//   - 400 ValidationError (input shape)
//   - 403 ForbiddenError (lacks subscription:resume)
//   - 404 NotFoundError (subscription not in tenant)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeSubscription } from "@/modules/subscriptions";
import { ResumeSubscriptionBodySchema } from "@/modules/subscriptions/schemas";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const body = parseBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(`/api/subscriptions/${id}/resume`, requestId);
    const result = await resumeSubscription(ctx, id, body);
    return NextResponse.json(result, { status: result.http_status });
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

function parseBody(body: unknown): { idempotency_key: string } {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "resume endpoint requires a body: { idempotency_key }",
    );
  }
  const parsed = ResumeSubscriptionBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`resume body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
