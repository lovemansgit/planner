// Day 12 / T1-A — x-pathname injection middleware.
//
// (app)/layout.tsx and (app)/tasks/page.tsx (and any future authed
// surface) call `headers().get("x-pathname")` to compute the
// `?next=…` query-string for the /login redirect on UnauthorizedError.
// Next.js doesn't populate this header by default in production —
// without middleware, server components see no x-pathname, so the
// redirect lands at /login?next=%2F regardless of the page the
// operator was trying to reach.
//
// This middleware mutates the request headers on every request so the
// downstream server component reads the pathname back via the
// canonical headers() API. We ignore the response side — `cookies()`
// for auth state is independent.
//
// Footprint is intentionally narrow: one header, every request, no
// branching. The matcher excludes Next.js internals and static files
// to keep the middleware off the hot path for assets.

import { NextResponse, type NextRequest } from "next/server";

export const PATHNAME_HEADER = "x-pathname";

export function middleware(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Skip Next.js internals + static assets — they don't render server
  // components that need the pathname header. Match every other path.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
