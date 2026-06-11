// Supabase Auth admin client.
//
// Wraps `supabase.auth.admin.createUser` for the identity service-layer
// path. Sibling to (a) the existing `scripts/onboard-*.mjs` provisioning
// scripts which build their own client inline, and (b) the request-side
// session client at src/shared/request-context.ts which uses the anon
// key + user-session cookies.
//
// Behavior on conflict (email already exists): falls through to
// `listUsers` paged-search and returns the existing auth user's id —
// matches the idempotency posture of scripts/onboard-merchant.mjs so
// re-issuing the same email through the UI surface doesn't 500 if the
// auth user already exists. The caller decides whether to treat that
// as a `ConflictError` at the Postgres mirror-insert layer (which it
// will — ON CONFLICT (id) DO UPDATE on the users mirror); we don't
// gate here.
//
// The service-role key is the auth boundary — never exposed to the
// client; never sent over the wire in user-facing surfaces. This
// module is server-only by construction (the secret is read from
// process.env at import time).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

/**
 * Lazy singleton for the Supabase Auth admin client. Reads
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from
 * process.env once; the same client is returned on every subsequent
 * call. Tests can reset via `__resetAuthAdminClientForTests`.
 */
function adminClient(): SupabaseClient {
  if (cachedClient !== null) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "auth-admin: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedClient;
}

/**
 * For tests — drops the cached client so each test can stub a fresh
 * `createClient` invocation if needed.
 */
export function __resetAuthAdminClientForTests(): void {
  cachedClient = null;
}

/**
 * Create a Supabase Auth user, or look up the existing one on email
 * collision. Returns the auth user's UUID either way.
 *
 *   - Sets `email_confirm: true` per pilot policy (operator hand-off
 *     bypasses email verification — trusted seeded users).
 *   - On `User already registered` from createUser, falls back to
 *     listUsers paged-search and returns the existing id. Matches the
 *     idempotency contract of scripts/onboard-merchant.mjs.
 *
 * Throws:
 *   - AuthAdminError on a non-collision failure (network, auth-service
 *     down, malformed input, etc.).
 *
 * The createUser path runs against Supabase Auth's hosted service.
 * Integration tests mock this fn at the service-layer boundary per
 * Day-23 §F (real-Postgres covers the mirror INSERT; the auth SDK is
 * a third-party boundary).
 */
export async function createOrFetchAuthUser(input: {
  readonly email: string;
  readonly password: string;
}): Promise<{ readonly authUserId: string; readonly created: boolean }> {
  const client = adminClient();
  const { data, error } = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (!error && data?.user) {
    return { authUserId: data.user.id, created: true };
  }
  if (error && !isAlreadyExistsError(error)) {
    throw new AuthAdminError(`auth.admin.createUser failed: ${error.message}`);
  }
  // Email collision — look up the existing user.
  const lower = input.email.toLowerCase();
  const { data: list, error: listErr } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    throw new AuthAdminError(
      `auth.admin.listUsers fallback after createUser collision failed: ${listErr.message}`,
    );
  }
  const existing = (list?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === lower,
  );
  if (!existing) {
    throw new AuthAdminError(
      `auth.admin.createUser collided on ${input.email} but listUsers did not find the row`,
    );
  }
  return { authUserId: existing.id, created: false };
}

function isAlreadyExistsError(error: { readonly message?: string }): boolean {
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("already") ||
    msg.includes("registered") ||
    msg.includes("duplicate")
  );
}

/**
 * Disable a Supabase Auth user — sets `ban_duration: '876000h'` (100
 * years per the SDK's longest-practical example at
 * GoTrueAdminApi.d.ts:561). The user cannot sign in until
 * `enableAuthUser` is called. Idempotent — re-disabling an already-
 * banned user is a no-op on Supabase's side.
 */
export async function disableAuthUser(authUserId: string): Promise<void> {
  const client = adminClient();
  const { error } = await client.auth.admin.updateUserById(authUserId, {
    ban_duration: "876000h",
  });
  if (error) {
    throw new AuthAdminError(
      `auth.admin.updateUserById disable failed: ${error.message}`,
    );
  }
}

/**
 * Re-enable a previously-disabled Supabase Auth user — clears the
 * ban via `ban_duration: 'none'`. Idempotent — calling on a non-
 * banned user is a no-op on Supabase's side.
 */
export async function enableAuthUser(authUserId: string): Promise<void> {
  const client = adminClient();
  const { error } = await client.auth.admin.updateUserById(authUserId, {
    ban_duration: "none",
  });
  if (error) {
    throw new AuthAdminError(
      `auth.admin.updateUserById enable failed: ${error.message}`,
    );
  }
}

export class AuthAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthAdminError";
  }
}
