---
name: Zod 4 UUID validation strictness
description: Zod 4's .uuid() enforces RFC 4122 version + variant nibbles; existing service-test fixtures using the all-1s UUID shape fail in any Zod-validated path
type: followup
---

Zod 4's `.uuid()` validator rejects UUID strings that don't conform to RFC 4122's
version + variant nibble constraints. Specifically it requires:

- 13th nibble (version): 1–8
- 17th nibble (variant): 8, 9, a, or b

Strings like `11111111-1111-1111-1111-111111111111` — pervasive in this repo's
service-layer test fixtures — pass everywhere except where Zod-uuid validation
runs (route bodies, schema regression tests, anywhere a Zod schema branch
calls `.uuid()`). The first encounter was in S-5's
[`src/modules/subscriptions/tests/schemas.spec.ts`](../src/modules/subscriptions/tests/schemas.spec.ts):
a fixture using the all-1s shape failed against `CreateSubscriptionBodySchema`'s
`consigneeId: z.string().uuid()`.

## Why it matters

Service-layer unit tests mock the repository and never run Zod validation, so
the fixtures in `src/modules/{consignees,tasks,subscriptions}/tests/service.spec.ts`
all happily use the all-1s shape. Anyone copy-pasting one of those fixtures
into a route-level or schema-level test will hit a confusing parse failure
that doesn't mention "version" or "variant" in the surface error — Zod just
says `invalid_format` against the regex
`/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|...)$/`.

The bracketed character classes `[1-8]` and `[89abAB]` are the give-away once
you see the regex; the surface error message doesn't surface them.

## Working fixture shape going forward

- **Pattern:** `xxxxxxxx-xxxx-4xxx-{8|9|a|b}xxx-xxxxxxxxxxxx`
- **Concrete fixture used in S-5 schema tests:** `11111111-1111-4111-8111-111111111111` — still recognisably-synthetic (mostly 1s), still RFC-compliant (4 = version, 8 = variant)
- **Better for new tests:** `crypto.randomUUID()` at fixture creation time — guarantees compliance, varies across runs, no risk of hand-rolled bit errors

## Escape hatches if needed

- `z.string().uuid({ version: "any" })` — Zod 4 accepts any version digit while still requiring the dash-shape and hex domain. Use when a fixture deliberately exercises a non-standard shape.
- `z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)` — full bypass of RFC checks. Use when a test needs the Postgres nil UUID (`00000000-0000-0000-0000-000000000000`) or other deliberately-non-conformant strings. The nil UUID is special-cased in Zod 4 (the regex above accepts it via the `|...000...|` alternation), so usually `.uuid()` itself works for it; the regex escape hatch is only needed for shapes Zod doesn't whitelist.

## Cross-references

- **First hit:** [`src/modules/subscriptions/tests/schemas.spec.ts`](../src/modules/subscriptions/tests/schemas.spec.ts) (S-5)
- **Existing 1111-only fixtures that won't break** (because they go through mocked repos, not Zod):
  - [`src/modules/consignees/tests/service.spec.ts`](../src/modules/consignees/tests/service.spec.ts)
  - [`src/modules/tasks/tests/service.spec.ts`](../src/modules/tasks/tests/service.spec.ts)
  - [`src/modules/subscriptions/tests/service.spec.ts`](../src/modules/subscriptions/tests/service.spec.ts)
  - [`src/modules/subscriptions/tests/repository.spec.ts`](../src/modules/subscriptions/tests/repository.spec.ts)
- **Update those fixtures opportunistically** — when next touched for an unrelated reason, swap to the UUIDv4 shape. Not a pre-emptive sweep; the existing fixtures work and re-running 500+ tests for a fixture cosmetic isn't worth a dedicated commit.
