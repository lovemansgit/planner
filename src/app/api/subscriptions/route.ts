// /api/subscriptions — collection routes (POST + GET).
//
// POST /api/subscriptions    subscription:create  → subscription.created
// GET  /api/subscriptions    subscription:read    (no audit, per R-4)
//
// Auth (Day 10): buildRequestContext resolves the Supabase Auth session
// to a per-tenant RequestContext; UnauthorizedError surfaces as 401 via
// errorResponse.
//
// Validation: Zod schemas at the boundary catch shape errors before
// the service layer. The service layer still validates business rules
// (trimmed non-empty strings, ISO 1-7 daysOfWeek domain) — boundary
// alone is not trusted.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createSubscription, listSubscriptions } from "@/modules/subscriptions";
import { CreateSubscriptionBodySchema } from "@/modules/subscriptions/schemas";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// POST /api/subscriptions
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = CreateSubscriptionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildRequestContext("/api/subscriptions", requestId);
    const created = await createSubscription(ctx, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// GET /api/subscriptions
// -----------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/api/subscriptions", requestId);
    const rows = await listSubscriptions(ctx);
    return NextResponse.json({ subscriptions: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
