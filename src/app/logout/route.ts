// Day 10. Logout endpoint.
//
// POST /logout — calls supabase.auth.signOut to clear the session
// cookies, then redirects to /login. Single canonical URL operators
// can hit from a navbar button (or a server-action wrapper).
//
// Idempotent: if there's no session, signOut is a no-op and the
// caller still lands on /login. No audit emit on logout (per project
// convention — logout is the absence of a session, not an action that
// requires forensic recording; if we want this later, register a
// `user.logout` event type alongside the session-introspection helper).

import "server-only";

import { NextResponse } from "next/server";

import { getServerSupabase } from "@/shared/request-context";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await getServerSupabase();
  await supabase.auth.signOut().catch(() => {
    // Best-effort: cookie-clear runs regardless via the SSR adapter.
  });
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, { status: 303 });
}

// Allow GET for navbar links / direct URL hits — dispatches to POST
// semantics. Same redirect target.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
