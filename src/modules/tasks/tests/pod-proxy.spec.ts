// POD proxy helpers — Day-53 PM, Love-ruled UAT-blocking
// (decision_d53_pm_uat_calls.md ruling 4; grounding:
// followup_pod_broken_image_pre_existing.md shape (e)).
//
// SF delivers POD photos as S3 pre-signed URLs (SigV4, 7-day TTL) that
// the browser may refuse to render even within TTL
// (ERR_BLOCKED_BY_RESPONSE) and S3 refuses after TTL (403 "Request has
// expired"). The operator UI therefore renders through a same-origin
// authenticated Planner proxy; these helpers are the pure seams.

import { describe, expect, it } from "vitest";

import {
  classifyPodUpstreamResponse,
  podProxyPhotoPaths,
} from "../pod-proxy";

const TASK_ID = "11111111-2222-3333-4444-555555555555";

describe("podProxyPhotoPaths", () => {
  it("maps each stored photo to its same-origin proxy path by index", () => {
    expect(podProxyPhotoPaths(TASK_ID, ["https://s3.example/a.jpg?sig=1", "https://s3.example/b.jpg?sig=2"])).toEqual([
      `/api/tasks/${TASK_ID}/pod/0`,
      `/api/tasks/${TASK_ID}/pod/1`,
    ]);
  });

  it("returns null for null photos (no POD received — pod-state contract preserved)", () => {
    expect(podProxyPhotoPaths(TASK_ID, null)).toBeNull();
  });

  it("returns an empty array for an empty array (treated as no POD by the surfacing layer)", () => {
    expect(podProxyPhotoPaths(TASK_ID, [])).toEqual([]);
  });
});

describe("classifyPodUpstreamResponse", () => {
  it("classifies 200 + image/* as ok", () => {
    expect(classifyPodUpstreamResponse(200, "image/jpeg")).toBe("ok");
    expect(classifyPodUpstreamResponse(200, "image/png")).toBe("ok");
  });

  it("classifies S3 403 as expired (observed live: AccessDenied 'Request has expired' XML)", () => {
    expect(classifyPodUpstreamResponse(403, "application/xml")).toBe("expired");
  });

  it("classifies 200 with a non-image body as upstream_error (S3 error envelope, not bytes)", () => {
    expect(classifyPodUpstreamResponse(200, "application/xml")).toBe("upstream_error");
    expect(classifyPodUpstreamResponse(200, null)).toBe("upstream_error");
  });

  it("classifies other statuses as upstream_error", () => {
    expect(classifyPodUpstreamResponse(404, "application/xml")).toBe("upstream_error");
    expect(classifyPodUpstreamResponse(500, "text/html")).toBe("upstream_error");
  });
});
