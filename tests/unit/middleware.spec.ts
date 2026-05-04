// Day 12 / T1-A — unit tests for the x-pathname injection middleware.
//
// Next.js middleware mutates request headers via NextResponse.next({
// request: { headers: ... } }). The runtime forwards the mutated
// headers via two response-side sentinel headers:
//
//   x-middleware-override-headers        — comma-separated list of
//                                          mutated header names
//   x-middleware-request-<header-name>   — the new value for each
//
// Server components downstream then read the header via the canonical
// headers() API. The tests below assert the sentinel headers are
// populated correctly so the round-trip is structurally pinned, even
// though the downstream layer is mocked at the framework boundary.

import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { middleware, PATHNAME_HEADER } from "../../middleware";

function callMiddleware(pathname: string) {
  const req = new NextRequest(new URL(`https://example.com${pathname}`));
  return middleware(req);
}

describe("x-pathname middleware", () => {
  it("sets x-pathname on /tasks", () => {
    const res = callMiddleware("/tasks");
    const overrides = res.headers.get("x-middleware-override-headers");
    expect(overrides).toMatch(/x-pathname/);
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/tasks");
  });

  it("sets x-pathname on / (landing page)", () => {
    const res = callMiddleware("/");
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/");
  });

  it("preserves subpath segments (e.g. /admin/failed-pushes)", () => {
    const res = callMiddleware("/admin/failed-pushes");
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe(
      "/admin/failed-pushes",
    );
  });

  it("preserves dynamic-segment paths (e.g. /tasks/<uuid>)", () => {
    const res = callMiddleware("/tasks/00000000-0000-0000-0000-000000000000");
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe(
      "/tasks/00000000-0000-0000-0000-000000000000",
    );
  });

  it("strips query string from x-pathname (only path component)", () => {
    const req = new NextRequest(new URL("https://example.com/tasks?status=DELIVERED&page=2"));
    const res = middleware(req);
    expect(res.headers.get(`x-middleware-request-${PATHNAME_HEADER}`)).toBe("/tasks");
  });

  it("PATHNAME_HEADER constant matches what (app)/layout.tsx reads", () => {
    // (app)/layout.tsx calls headers().get("x-pathname"). If the
    // export name drifts from that literal, the round-trip breaks
    // silently. Pinning the constant against the layout's read is
    // the regression guard.
    expect(PATHNAME_HEADER).toBe("x-pathname");
  });
});
