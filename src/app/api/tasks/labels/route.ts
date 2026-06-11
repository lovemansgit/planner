// POST /api/tasks/labels   task:print_labels → task.labels_printed
//
// Day 8 / D8-6. Operator-driven SuiteFleet shipment-label print.
// Body: `{ taskIds: string[] }` (Zod-validated: array of UUIDs,
// 1..PRINT_LABELS_MAX_TASKS_PER_REQUEST).
//
// Success: 200 with `application/pdf` body. The response is the
// rendered PDF binary; metadata about requested-vs-printed counts
// (the visibility filter's drop count) is on response headers
// (X-Requested-Count / X-Printed-Count) so the operator UI can
// surface the split without parsing the PDF, while the audit event
// captures the same numbers for forensic queries.
//
// =============================================================================
// SECURITY — see memory/followup_suitefleet_label_endpoint.md
// =============================================================================
// The SF endpoint accepts the bearer token as a query parameter. The
// architectural rule is: the operator browser MUST NEVER see this URL
// or the token in any form. This route fetches the SF endpoint
// server-side via the SuiteFleet adapter, reads the response into a
// Buffer, and streams the bytes back. The operator's network panel
// only sees `/api/tasks/labels` — no SF host, no token.
//
// The constructed SF URL exists ONLY inside label-client.ts; no other
// layer (route, service, factory) ever holds it.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSuiteFleetLastMileAdapter } from "@/modules/integration";
import {
  printLabelsForTasks,
  PRINT_LABELS_MAX_TASKS_PER_REQUEST,
} from "@/modules/tasks";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime — withTenant + the SF fetch path require Node sockets.
export const runtime = "nodejs";

const BodySchema = z
  .object({
    taskIds: z
      .array(z.string().uuid({ message: "task id must be a uuid" }))
      .min(1, { message: "taskIds must be non-empty" })
      .max(PRINT_LABELS_MAX_TASKS_PER_REQUEST, {
        message: `taskIds must be ≤ ${PRINT_LABELS_MAX_TASKS_PER_REQUEST}`,
      }),
  })
  .strict();

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const rawBody = (await req.json().catch(() => undefined)) ?? {};
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new ValidationError(
        `body validation failed: ${parsed.error.message}`,
      );
    }
    const { taskIds } = parsed.data;

    const ctx = await buildRequestContext("/api/tasks/labels", requestId);
    const adapter = createSuiteFleetLastMileAdapter({
      fetch: globalThis.fetch,
      clock: () => new Date(),
    });

    const result = await printLabelsForTasks(ctx, taskIds, adapter);

    // Filename anchored on UTC date + count for operator
    // bookkeeping. UTC over local because the planner is server-side
    // — the date the file was generated, not the operator's local
    // calendar day. Operators in Asia/Dubai see UTC date that's
    // sometimes "previous day" relative to local; acceptable for
    // pilot, revisit if confusing.
    const dateUtc = new Date().toISOString().slice(0, 10);
    const filename = `labels-${dateUtc}-${result.printedCount}-tasks.pdf`;

    // Day 17 — partial-success headers for the Planner UUID → SF
    // external_id translation. When the service skipped tasks because
    // they hadn't been pushed to SF yet, surface the count + reason
    // via response headers so the UI can render a banner without
    // parsing the audit log. X-Skipped-* headers added only when
    // non-zero so the success-path response stays minimal.
    const headers: Record<string, string> = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Forensic split surfaced on response headers so the UI can
      // render "28 of 30 selected tasks printed" without parsing
      // the PDF or making a separate audit-log query. Mirrors the
      // audit metadata's requested_count / printed_count.
      "X-Requested-Count": String(result.requestedCount),
      "X-Printed-Count": String(result.printedCount),
      // Don't cache: the PDF reflects current task state at render
      // time. SF could re-render with different content if a task
      // were re-pushed; cached PDFs would diverge.
      "Cache-Control": "no-store, max-age=0",
    };
    if (result.skippedCount > 0) {
      headers["X-Skipped-Count"] = String(result.skippedCount);
      headers["X-Skipped-Reason"] = "not-pushed-to-suitefleet";
    }

    return new NextResponse(result.pdfBuffer as unknown as BodyInit, {
      status: 200,
      headers,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
