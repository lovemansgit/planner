// GET /api/tasks/[id]/pod/[index]   task:read → POD photo bytes
//
// Day-53 POD proxy (Love-ruled UAT-blocking, decision_d53_pm_uat_calls.md
// ruling 4). SF's POD photos are S3 pre-signed URLs (7-day TTL) that the
// browser may refuse even within TTL (ERR_BLOCKED_BY_RESPONSE, Day-33)
// and S3 hard-403s after TTL. This route resolves the stored URL
// server-side (same tenant + permission gate as the task row), fetches
// it with Node sockets — immune to browser response policy — and
// streams the bytes back same-origin. Grounding + the post-UAT durable
// ingest-capture follow-on: src/modules/tasks/pod-proxy.ts and
// memory/followup_pod_broken_image_pre_existing.md.
//
// Same security posture as /api/tasks/labels: the operator browser
// never sees the SF host or the signed URL — only this Planner path.
//
// Day-53 EVE (cleared #413 lane) — two changes:
//   1. CAPTURED-FIRST: the durable copy in the private pod-photos
//      bucket (migration 0031 + pod-capture module) is preferred over
//      the vendor URL; the SF fetch only happens when nothing was
//      captured (pre-capture history, or a capture that failed and
//      sits in the DLQ).
//   2. H3 (Tier-2 ruling memo, Love-assigned to this lane): the
//      vendor-expired state serves a styled SVG placeholder (200,
//      X-Planner-Pod-State: expired-at-vendor) instead of the bare
//      410 — an <img> cannot render a 410 body, so every consumer
//      surface showed the browser's broken-image icon. The run sheet's
//      expired-state line is updated in the same PR (proven observable,
//      Love-ruled change).
//
// Status mapping:
//   captured copy exists  → 200, stored bytes, longer private cache
//   200 image/*           → 200, bytes streamed, short private cache
//   S3 403 (sig expired)  → 200 styled SVG placeholder +
//                           X-Planner-Pod-State: expired-at-vendor (H3)
//   anything else         → 502 upstream error
//   fetch threw           → 502 upstream error

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSupabasePodObjectStore,
  getCapturedPodPhoto,
  podExpiredPlaceholderSvg,
} from "@/modules/pod-capture";
import { getPodPhotoSourceUrl } from "@/modules/tasks";
import { classifyPodUpstreamResponse } from "@/modules/tasks/pod-proxy";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime — withTenant + the S3 fetch require Node sockets.
export const runtime = "nodejs";

const log = logger.with({ component: "pod_proxy_route" });

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });
// SF tasks carry a handful of photos; 50 is a generous structural bound
// that keeps the path namespace from accepting arbitrary integers.
const IndexParamSchema = z.coerce.number().int().min(0).max(50);

type RouteContext = { params: Promise<{ id: string; index: string }> };

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  try {
    const { id: rawId, index: rawIndex } = await params;
    const idResult = IdParamSchema.safeParse(rawId);
    if (!idResult.success) {
      throw new ValidationError(`id must be a uuid, got '${rawId}'`);
    }
    const indexResult = IndexParamSchema.safeParse(rawIndex);
    if (!indexResult.success) {
      throw new ValidationError(`index must be a small non-negative integer, got '${rawIndex}'`);
    }

    const ctx = await buildRequestContext(
      `/api/tasks/${idResult.data}/pod/${indexResult.data}`,
      requestId,
    );

    // Captured-first (Day-53 EVE): the durable copy outlives the
    // vendor's 7-day TTL and skips the upstream round-trip entirely.
    const captured = await getCapturedPodPhoto(
      ctx,
      idResult.data as Uuid,
      indexResult.data,
      { store: createSupabasePodObjectStore({ fetch: globalThis.fetch }) },
    );
    if (captured !== null) {
      return new NextResponse(captured.bytes, {
        status: 200,
        headers: {
          "Content-Type": captured.contentType,
          // Captured objects are immutable — a longer private cache is
          // safe and keeps repeat views off the storage API.
          "Cache-Control": "private, max-age=86400",
          "X-Planner-Pod-State": "captured",
        },
      });
    }

    const sourceUrl = await getPodPhotoSourceUrl(
      ctx,
      idResult.data as Uuid,
      indexResult.data,
    );

    let upstream: Response;
    try {
      upstream = await fetch(sourceUrl, { redirect: "follow" });
    } catch (fetchErr) {
      log.warn({
        operation: "pod_proxy_fetch",
        error_code: "upstream_unreachable",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
        message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
      return NextResponse.json(
        { error: "pod photo upstream unreachable" },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type");
    const klass = classifyPodUpstreamResponse(upstream.status, contentType);

    if (klass === "expired") {
      // H3: past-TTL pre-signed URL with no captured copy — vendor-dead,
      // deterministic. Serve the styled placeholder image (an <img>
      // cannot render an error body); the response header keeps the
      // state machine-distinguishable for tests and forensics.
      log.info({
        operation: "pod_proxy_fetch",
        error_code: "expired_at_vendor",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
      });
      return new NextResponse(podExpiredPlaceholderSvg(), {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "private, max-age=3600",
          "X-Planner-Pod-State": "expired-at-vendor",
        },
      });
    }
    if (klass === "upstream_error") {
      log.warn({
        operation: "pod_proxy_fetch",
        error_code: "upstream_error",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
        upstream_status: upstream.status,
        upstream_content_type: contentType,
      });
      return NextResponse.json(
        { error: "pod photo upstream error" },
        { status: 502 },
      );
    }

    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType ?? "image/jpeg",
        // Same-tenant authorized bytes; short private cache keeps the
        // lightbox snappy without persisting past the operator session.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
