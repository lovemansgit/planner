---
name: Auth-token cookie missing HttpOnly + Secure flags (T2, pre-MVP)
description: @supabase/ssr 0.10.x setAll callback writes the auth-token cookie without HttpOnly or Secure flags by default. Surfaced 3 May 2026 via Day-10 P2 cross-tenant probe step 1. SameSite=lax IS present (CSRF defense load-bearing). Fix is one-touch in src/shared/request-context.ts cookie adapter; should land before MVP go-live (Day 14).
type: project
---

# Auth-token cookie missing HttpOnly + Secure flags

**Surfaced:** 3 May 2026 (Day 10 P2 cross-tenant probe step 1, post-#104 merge)
**Tier:** T2 (defense-in-depth gap; not blocking auth correctness)
**Target:** land before Day-14 MVP go-live

---

## What the probe surfaced

Step 1 of the P2 cross-tenant probe captured the Set-Cookie header on a successful login response from the Preview deployment:

```
set-cookie: sb-qdotjmwqbyzldfuxphei-auth-token=base64-eyJ...; Path=/; Expires=Mon, 07 Jun 2027 12:58:26 GMT; Max-Age=34560000; SameSite=lax
```

Flags present:  `Path=/`, `Expires`, `Max-Age=34560000` (40-day refresh window per Supabase Auth defaults), `SameSite=lax`.

Flags **missing**: `HttpOnly`, `Secure`.

## Why this matters

Two attack vectors not currently mitigated:

1. **XSS-driven token theft.** Without `HttpOnly`, any JS running in the same origin can read the cookie via `document.cookie` and exfiltrate the access token + refresh token. The session cookie is base64-encoded JSON containing the JWT — pasted into Authorization headers, an attacker has full impersonation. XSS vector requires another bug to inject the attacker's JS, but `HttpOnly` is the standard cheap defense if that vector ever opens.

2. **MITM on plaintext channels.** Without `Secure`, the cookie can be sent over HTTP. In production this matters because HTTP→HTTPS redirects don't help if the cookie has already been sent on the redirect-source plaintext request. Vercel's HSTS preload reduces (but does not eliminate) the window.

`SameSite=lax` IS present, which provides CSRF defense (the cookie won't be sent on cross-origin POST requests). That's the load-bearing security flag for the auth surface and it's correct.

## Why @supabase/ssr 0.10.x defaults are this way

The `@supabase/ssr` cookie adapter's `setAll(cookiesToSet)` callback receives a list of `{ name, value, options }` and the SDK delegates the actual cookie write to the framework's `cookieStore.set(name, value, options)`. The library passes through whatever `options` Supabase Auth's session-cookie writer supplies. By default the writer sets `path` and `sameSite` but not `httpOnly` or `secure` — the library treats those as caller responsibility.

Our adapter at [src/shared/request-context.ts:73-87](src/shared/request-context.ts#L73-L87):

```ts
setAll(cookiesToSet) {
  try {
    for (const { name, value, options } of cookiesToSet) {
      cookieStore.set(name, value, options as CookieOptions);
    }
  } catch {
    // RSC swallow
  }
}
```

passes `options` through unchanged. The fix is to merge `{ httpOnly: true, secure: true }` into options at the adapter, OR to set them once at the top:

```ts
setAll(cookiesToSet) {
  try {
    for (const { name, value, options } of cookiesToSet) {
      cookieStore.set(name, value, {
        ...(options as CookieOptions),
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      });
    }
  } catch {
    // RSC swallow
  }
}
```

The `secure` flag conditionally on production keeps `localhost` (HTTP-only) usable for local dev. Vercel Preview + Production are HTTPS, so `secure: true` flows through correctly.

## What to verify

After the fix lands and Preview re-deploys, re-run probe step 1 (just the login curl). Expected Set-Cookie:

```
set-cookie: sb-...-auth-token=base64-...; Path=/; Expires=...; Max-Age=34560000; SameSite=lax; HttpOnly; Secure
```

Both `HttpOnly` and `Secure` should be present. `SameSite=lax` continues unchanged.

Also worth checking on the cookie ALSO removed by /logout — the same flags should be on the `Set-Cookie: sb-...-auth-token=; Max-Age=0; ...; HttpOnly; Secure` clear directive.

## Test plan

Add a unit test to `src/shared/tests/request-context.spec.ts` that asserts the `setAll` adapter passes `httpOnly: true` and `secure: true` (in production) to the underlying cookieStore.set call. Mock `process.env.NODE_ENV` to verify the conditional. ~3-4 unit tests (set in production / unset in dev / clear-cookie path).

## Sequencing

T2, single-touch in `src/shared/request-context.ts`. Lands as a small standalone PR before Day-14 go-live. Should be paired with the Posture B retirement T1 follow-up (whichever lands first carries the verification responsibility).

## Cross-references

- [src/shared/request-context.ts](src/shared/request-context.ts) — the cookie adapter that needs the option additions
- Day-10 P2 cross-tenant probe (3 May 2026) — surfacing event
- [memory/plans/auth_implementation_plan.md](memory/plans/auth_implementation_plan.md) §10 watch-list — adjacent security posture
- [memory/followup_audit_failed_attempts.md](memory/followup_audit_failed_attempts.md) — wider auth-surface follow-up corpus
