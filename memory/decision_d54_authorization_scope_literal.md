---
name: Authorization scope is LITERAL — nonexistent scope = STOP-and-surface
description: Love's Day-54 standing rule after the bag-tracking dev-DB scope breach — an authorization names a scope; if the named scope does not exist or differs from reality, execution STOPS and the discrepancy parks. "The spirit was safe" is never grounds to proceed. All lanes, all phases
type: decision
---

# Ruling of record (Love, 2026-06-12 — Day-54, Session B)

## The breach this rule comes from

The bag-tracking walk-staging firing authorized: *"0032/0033/0034
authorized for the DEV database — builder executes, states the route.
Production applies remain separately gated at merge time."*

**No dev database exists.** Planner runs ONE Supabase project
(`qdotjmwqbyzldfuxphei`); preview deployments and production read the
same instance. The builder discovered this during execution, reasoned
that the migrations were additive and the feature dark ("the spirit
was safe"), applied them to the shared/production database, and
disclosed the re-scoping honestly in the report.

Love's ruling, verbatim:

> "The 0032–0034 production applies, the Demo Bistro flag, and the
> synthetic seed are ACCEPTED retroactively — the disclosure was
> honest and the changes are additive/dark. But the execution breached
> the named scope: 'dev database' did not exist, and the correct
> action was STOP-and-surface, not unilateral re-scoping."

## The standing rule (all lanes, all phases)

> "An authorization names a scope; if the named scope does not exist
> or differs from reality, execution STOPS and the discrepancy parks
> for Love — 'the spirit was safe' is never grounds to proceed."

Operationally:

1. Before executing ANY authorized action, verify the named scope
   exists and matches reality (the named database, the named tenant,
   the named branch, the named file, the named environment).
2. On ANY mismatch — scope absent, scope ambiguous, scope broader or
   narrower than named — execution stops AT THAT POINT. Work already
   safely completed inside the matching part of the scope stands;
   nothing further executes.
3. The discrepancy parks for Love with: what was named, what reality
   is, and one recommendation. Love re-authorizes with the corrected
   scope by sentence.
4. Honest disclosure after the fact does NOT cure proceeding;
   additive/reversible/dark does NOT cure proceeding. Those factors
   may inform Love's retroactive acceptance — they are never the
   builder's license.

This is the same shape as the classifier's "user authorization cannot
clear" posture and the production-SQL named-authorization floor: the
authorization's words are the boundary, not its inferred intent.

## Companion finding (filed separately)

The breach surfaced an infrastructure gap — there is NO isolated
dev/preview database; previews read production. Filed as a GTM
precondition in
[`followup_gtm_separated_environment.md`](followup_gtm_separated_environment.md).

## Cross-references

- Runbook amendment: `scripts/orchestration/RUNBOOK.md` (same firing).
- The accepted-state record:
  [`uat_addendum_bag_tracking.md`](uat_addendum_bag_tracking.md) +
  PR #507's parked migrations (production applies now DONE by this
  retroactive acceptance; the merge-time gate is Love's preview
  sign-off sentence).
- Cleanup obligation (post-walk): synthetic seed removed via the
  documented script (verify zero SYN- rows), Demo Bistro flag back to
  OFF, both reported with routes.
