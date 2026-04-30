// POST /api/subscriptions/:id/end   subscription:end → subscription.ended
//
// Lifecycle transition: 'active' | 'paused' → 'ended' (terminal). No
// request body. Reactivation is not supported; create a new
// subscription instead.
//
// Returns 404 when the row is missing or RLS-hidden.
// Returns 409 (ConflictError → CONFLICT) when the row is already
// 'ended' — propagated from the repository.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { endSubscription } from "@/modules/subscriptions";
import { buildDemoContext } from "@/shared/demo-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/subscriptions/${id}/end`, requestId);
    const updated = await endSubscription(ctx, id);
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
