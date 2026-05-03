// /api/consignees/[id] — per-row routes (GET + PATCH + DELETE).
//
// GET    /api/consignees/:id   consignee:read    (no audit, per R-4)
// PATCH  /api/consignees/:id   consignee:update  → consignee.updated
//                                                 (only when fields change)
// DELETE /api/consignees/:id   consignee:delete  → consignee.deleted
//
// Same demo-context + Zod-at-boundary pattern as the collection route.
// Returns 404 when the row is missing or RLS-hidden — same observable
// state from the caller's viewpoint per R-3.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteConsignee, getConsignee, updateConsignee } from "@/modules/consignees";
import { buildDemoContext } from "@/shared/demo-context";
import { NotFoundError, ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// Request schemas
// -----------------------------------------------------------------------------

const IdParamSchema = z
  .string()
  .uuid({ message: "id must be a uuid" });

const UpdateBodySchema = z
  .object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    addressLine: z.string().optional(),
    emirateOrRegion: z.string().optional(),
    deliveryNotes: z.string().optional(),
    externalRef: z.string().optional(),
    notesInternal: z.string().optional(),
  })
  .strict();

// Next.js 16 dynamic route segments are async — `params` is a Promise.
type RouteContext = { params: Promise<{ id: string }> };

// -----------------------------------------------------------------------------
// GET /api/consignees/:id
// -----------------------------------------------------------------------------

export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/consignees/${id}`, requestId);
    const row = await getConsignee(ctx, id);
    if (!row) {
      throw new NotFoundError(`consignee not found: ${id}`);
    }
    return NextResponse.json(row);
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// PATCH /api/consignees/:id
// -----------------------------------------------------------------------------

export async function PATCH(req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);

    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = UpdateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildDemoContext(`/api/consignees/${id}`, requestId);
    const updated = await updateConsignee(ctx, id, parsed.data);
    return NextResponse.json(updated);
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// DELETE /api/consignees/:id
// -----------------------------------------------------------------------------

export async function DELETE(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/consignees/${id}`, requestId);
    await deleteConsignee(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseId(raw: string): string {
  const result = IdParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`id must be a uuid, got '${raw}'`);
  }
  return result.data;
}
