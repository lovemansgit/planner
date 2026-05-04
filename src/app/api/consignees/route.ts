// /api/consignees — collection routes (POST + GET).
//
// POST /api/consignees     consignee:create  → consignee.created
// GET  /api/consignees     consignee:read    (no audit, per R-4)
//
// Auth (Day 10): buildRequestContext resolves the Supabase Auth session
// to a per-tenant RequestContext; UnauthorizedError surfaces as 401 via
// errorResponse. Posture A graceful migration keeps the demo-context
// fallthrough behind ALLOW_DEMO_AUTH=true (Preview-only) until the
// post-soak Posture B follow-up retires it.
//
// Validation: Zod schemas at the boundary catch shape errors (wrong
// type, missing required field) before the service layer. The
// service layer still validates business rules (E.164 phone, non-
// empty trimmed strings) — we don't trust the boundary alone.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createConsignee, listConsignees } from "@/modules/consignees";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// Request body schema
// -----------------------------------------------------------------------------
// All required fields enforced at boundary; optional fields permitted
// to be undefined or string. Empty strings are accepted at the schema
// layer and trimmed by the service layer (which then rejects required
// fields that trim to empty).
const CreateBodySchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string().optional(),
  addressLine: z.string(),
  emirateOrRegion: z.string(),
  district: z.string(),
  deliveryNotes: z.string().optional(),
  externalRef: z.string().optional(),
  notesInternal: z.string().optional(),
});

// -----------------------------------------------------------------------------
// POST /api/consignees
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildRequestContext("/api/consignees", requestId);
    const created = await createConsignee(ctx, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// GET /api/consignees
// -----------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/api/consignees", requestId);
    const rows = await listConsignees(ctx);
    return NextResponse.json({ consignees: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
