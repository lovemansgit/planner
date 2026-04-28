---
name: SuiteFleet credential resolver — type narrowing past the missing-vars throw
description: resolveSuiteFleetCredentials uses `as string` casts after the missing-vars throw because TS can't narrow through the early-return pattern as written. Trivial refactor removes the casts.
type: project
originSessionId: e186efae-548c-4ee9-90fd-92f9249d7b20
---
`src/modules/credentials/suitefleet-resolver.ts` (Day-4 / S-3) reads four env vars, pushes any missing ones onto a list, throws if non-empty, then returns the four fields with `as string` casts:

```typescript
const username = env[ENV_USERNAME];
// ... pushes missing names onto an array
if (missing.length > 0) throw new CredentialError(...);
return {
  username: username as string,  // cast required
  ...
};
```

TypeScript can't narrow the local `username` to `string` through the array-of-missing-names early-return pattern: the array push happens by value, not by the variable's existence, so the compiler doesn't know `username` is non-undefined after the throw.

**Why:** Aggregate-and-throw produces the operator-friendly "names every missing var in one error" UX, which is worth keeping. The cost is two-pass type narrowing the compiler can't see through.

**How to apply:** Refactor to a single guarded throw with an explicit narrowed return:

```typescript
if (!username || !password || !clientId || !customerIdRaw) {
  const missing = [
    !username && ENV_USERNAME,
    !password && ENV_PASSWORD,
    !clientId && ENV_CLIENT_ID,
    !customerIdRaw && ENV_CUSTOMER_ID,
  ].filter(Boolean);
  throw new CredentialError(`SuiteFleet sandbox credentials missing from environment: ${missing.join(", ")}`);
}
// Below this line, all four are narrowed to `string` — casts gone.
const customerId = Number.parseInt(customerIdRaw, 10);
```

The single-condition guard narrows all four locals at once, the missing-name list is built only on the throw branch, and the return statement no longer needs `as string` casts. The type system then enforces the missing-vars invariant directly.

Trivial change; revisit when the resolver is touched next (Day-5 Secrets Manager swap is the natural moment — the secrets-manager fetch will likely return a `Record<string, string | undefined>` too, so the narrowing pattern will land cleanly there).
