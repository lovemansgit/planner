// POST /api/subscriptions/:id/resume   subscription:resume → subscription.resumed
//
// Lifecycle transition: 'paused' → 'active'. Takes NO request body —
// id is path-only, transition is the verb. An incoming body MAY be
// empty (`{}`) or absent; ANY key is rejected.
//
// Success: 200 with the updated Subscription as JSON.
// Returns 404 when the row is missing or RLS-hidden.
// Returns 409 (ConflictError → CONFLICT, mapped at error-response.ts:51)
// when the row exists but is not in 'paused' state — propagated from
// the repository.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resumeSubscription } from "@/modules/subscriptions";
import { LifecycleNoBodySchema } from "@/modules/subscriptions/schemas";
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
    rejectAnyBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext(`/api/subscriptions/${id}/resume`, requestId);
    const updated = await resumeSubscription(ctx, id);
    return NextResponse.json(updated);
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

function rejectAnyBody(body: unknown): void {
  if (body === undefined) return;
  const parsed = LifecycleNoBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      `lifecycle endpoint takes no body: ${parsed.error.message}`
    );
  }
}
