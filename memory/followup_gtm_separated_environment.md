---
name: GTM precondition — separated dev/preview environment
description: Day-54 infrastructure finding (Love-ruled, on the record) — there is no isolated dev/preview database; Vercel previews read the production Supabase. A separated environment is a GTM precondition alongside Supabase Pro, before the first real merchant
type: followup
---

# Infrastructure finding (Love's ruling, 2026-06-12 — Day-54)

**There is no isolated dev/preview database.** Planner runs a single
Supabase project (`qdotjmwqbyzldfuxphei`); the Vercel Preview AND
Production environment scopes point at the same instance. Every
preview deployment reads — and can write — production data.

Surfaced by the bag-tracking walk staging: a firing authorized
migration applies "for the DEV database," and no such database existed
to apply them to (see
[`decision_d54_authorization_scope_literal.md`](decision_d54_authorization_scope_literal.md)
for the scope rule that breach produced).

## Love's ruling, verbatim

> "INFRASTRUCTURE FINDING on the record: there is no isolated dev/
> preview database — previews read production. File as a GTM
> precondition alongside Supabase Pro: a separated environment before
> the first real merchant."

## What "separated environment" means at execution time

- A second Supabase project (or branch database) for preview/dev:
  own connection strings, own migration state, own seed data.
- Vercel Preview env scope repointed at it (today Production +
  Preview share values — the existing env convention memo
  `feedback_vercel_env_scope_convention.md` gets a companion rule:
  Preview points at the dev instance once it exists).
- Migration flow becomes two-stage for real: apply to dev for preview
  walks (builder-executable on firing-level authorization), apply to
  production ONLY at merge time on named authorization — the
  distinction Love's Day-54 firing already assumed existed.
- Pairs with the standing Supabase Pro upgrade decision as the
  infrastructure budget line for go-to-market.

## Gate

**Before the first real merchant.** Tracked alongside the Supabase
Pro upgrade — neither is a today-blocker for the pilot, both are
preconditions for GTM.
