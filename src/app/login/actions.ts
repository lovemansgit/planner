// Day 10. Login server action.
//
// Server-side handler invoked by the form on /login. Uses Supabase Auth
// signInWithPassword. On success: emits `user.login_succeeded` (user-
// attributed) and redirects to the validated `next` URL. On failure:
// emits `user.login_failed` (system-attributed, tenant_id resolved from
// the email when possible) with a structured `reason` enum.
//
// AUDIT METADATA HYGIENE (per memory/plans/auth_implementation_plan.md
// watch-list addition #2):
//
//   `user.login_failed` metadata is exactly { email, reason, ip_address }.
//   The submitted password MUST NEVER appear in metadata under ANY
//   encoding — not hashed, not prefixed, not first-N-characters, not as
//   a Boolean ("password was supplied"). This file MUST NOT pass the
//   password value (or anything derived from it) into the metadata
//   builder. Reviewer: confirm the absence by reading the failure
//   branches below.
//
// REASON ENUM (locked at plan approval):
//   - invalid_credentials: email exists but password wrong
//   - rate_limited:        Supabase rate-limit hit
//   - account_disabled:    users.disabled_at IS NOT NULL OR auth ban
//   - unknown:             catch-all for unrecognised failure modes

"use server";

import { sql as sqlTag } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { emit } from "@/modules/audit";
import { withServiceRole } from "@/shared/db";
import { getServerSupabase } from "@/shared/request-context";

export type LoginFailureReason =
  | "invalid_credentials"
  | "rate_limited"
  | "account_disabled"
  | "unknown";

export interface LoginActionState {
  readonly error?: string;
}

/**
 * Resolve the request's IP from common Vercel/proxy headers. Returns
 * null when no header carries one (local dev without a proxy). Stored
 * in audit metadata only — never reflected to clients.
 */
async function resolveIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

/**
 * Resolve the public.users mirror row for an email — used to attribute a
 * failed login event to the right tenant when possible. withServiceRole
 * because we have no tenant context at login time. Returns null when
 * the email is not on file (unknown email → null tenant_id on the
 * audit event → cross-tenant / sysadmin-only visibility).
 */
async function lookupUserByEmail(
  email: string,
): Promise<{ id: string; tenant_id: string; disabled_at: string | null } | null> {
  return await withServiceRole("auth: lookup user by email for failure audit", async (tx) => {
    type Row = { id: string; tenant_id: string; disabled_at: string | null };
    const rows = await tx.execute<Row>(sqlTag`
      SELECT id, tenant_id, disabled_at
      FROM users
      WHERE lower(email) = lower(${email})
      LIMIT 1
    `);
    return rows[0] ?? null;
  });
}

/**
 * Map a Supabase Auth signInWithPassword error to the structured reason
 * enum. The Supabase SDK surfaces error.message as English strings; we
 * pattern-match defensively and fall through to "unknown" for anything
 * we don't recognise.
 *
 * `account_disabled` is asserted by the caller separately (we look up
 * the public.users mirror's disabled_at), so this helper handles only
 * the auth-layer string mapping.
 */
function mapAuthErrorReason(message: string | undefined): LoginFailureReason {
  if (!message) return "unknown";
  const lower = message.toLowerCase();
  if (lower.includes("invalid login credentials") || lower.includes("invalid_credentials")) {
    return "invalid_credentials";
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "rate_limited";
  }
  if (lower.includes("banned") || lower.includes("disabled")) {
    return "account_disabled";
  }
  return "unknown";
}

function sanitizeNext(next: string | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

/**
 * Login server action. Uses `useActionState` shape — receives prior
 * state + FormData, returns next state. Throws NEXT_REDIRECT on success
 * (Next.js handles).
 */
export async function loginAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const emailRaw = formData.get("email");
  const passwordRaw = formData.get("password");
  const nextRaw = formData.get("next");
  const ipAddress = await resolveIp();

  const email = typeof emailRaw === "string" ? emailRaw.trim() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const next = sanitizeNext(typeof nextRaw === "string" ? nextRaw : undefined);

  if (!email || !password) {
    // Form validation failure: do NOT emit a login_failed event for an
    // empty submission — it isn't an attempted credential, it's a form
    // misuse. Return inline error.
    return { error: "Email and password are required." };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    const reason = mapAuthErrorReason(error?.message);
    // Try to attribute the failure to the right tenant. Best-effort.
    const userRow = await lookupUserByEmail(email).catch(() => null);
    const tenantId = userRow?.tenant_id ?? null;
    // If the public.users mirror row is disabled, override the reason
    // — the auth layer may surface invalid_credentials for a banned
    // user too, depending on Supabase config.
    const finalReason: LoginFailureReason =
      userRow?.disabled_at !== null && userRow?.disabled_at !== undefined
        ? "account_disabled"
        : reason;

    // CRITICAL: metadata is { email, reason, ip_address } only. NOT
    // password. NOT password-derived. NOT password-shape-hint. Reviewer:
    // confirm by reading this object literal verbatim.
    await emit({
      eventType: "user.login_failed",
      actorKind: "system",
      actorId: "auth:login",
      tenantId,
      metadata: {
        email,
        reason: finalReason,
        ip_address: ipAddress,
      },
      ipAddress: ipAddress ?? undefined,
    }).catch(() => {
      // Best-effort. Audit failure must NOT mask the auth failure to
      // the user — they still get the inline error below.
    });

    return { error: messageFor(finalReason) };
  }

  // Success path. The user is authenticated. Pull the mirror row to
  // confirm tenant + capture disabled_at; if disabled (race with admin
  // disable), sign back out + audit-fail.
  const userRow = await lookupUserByEmail(email).catch(() => null);
  if (!userRow) {
    // Auth.users exists but no public.users mirror row — onboarding
    // incomplete. Sign out + audit-fail with reason 'unknown' so the
    // session doesn't linger.
    await supabase.auth.signOut().catch(() => {});
    await emit({
      eventType: "user.login_failed",
      actorKind: "system",
      actorId: "auth:login",
      tenantId: null,
      metadata: { email, reason: "unknown", ip_address: ipAddress },
      ipAddress: ipAddress ?? undefined,
    }).catch(() => {});
    return { error: "Account is not provisioned. Contact your administrator." };
  }
  if (userRow.disabled_at) {
    await supabase.auth.signOut().catch(() => {});
    await emit({
      eventType: "user.login_failed",
      actorKind: "system",
      actorId: "auth:login",
      tenantId: userRow.tenant_id,
      metadata: { email, reason: "account_disabled", ip_address: ipAddress },
      ipAddress: ipAddress ?? undefined,
    }).catch(() => {});
    return { error: messageFor("account_disabled") };
  }

  await emit({
    eventType: "user.login_succeeded",
    actorKind: "user",
    actorId: data.user.id,
    tenantId: userRow.tenant_id,
    metadata: { ip_address: ipAddress },
    ipAddress: ipAddress ?? undefined,
  }).catch(() => {});

  redirect(next);
}

function messageFor(reason: LoginFailureReason): string {
  switch (reason) {
    case "invalid_credentials":
      return "Invalid email or password.";
    case "rate_limited":
      return "Too many attempts. Please try again in a few minutes.";
    case "account_disabled":
      return "This account is disabled. Contact your administrator.";
    case "unknown":
      return "Sign-in failed. Please try again.";
  }
}
