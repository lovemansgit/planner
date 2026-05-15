# 🔴 LOAD-BEARING — Production identity schema is absent

> **SUPERSEDED — see [`memory/audit/day-27-production-schema-audit-findings.md`](audit/day-27-production-schema-audit-findings.md).**
>
> The Day-27 audit established that production's identity schema is intact: all four tables this memo claims absent are present, `set_updated_at()` is present, and `public.users.updated_at` is present. The factual basis of this memo is invalidated. Migration 0024's failure is still real and unexplained, but is no longer attributed to absent identity schema. This file is retained as historical record of Day-26's diagnostic conclusion; it is no longer load-bearing.

**Filed:** Day-26 (14 May 2026), PM-late. Blocks Vercel promote of the
Day-26 per-merchant SF credentials lane until resolved.

## Summary

During the Day-26 production cutover for the per-merchant SF
credentials lane (migration 0024), the production database was found
to be missing four of the five core identity tables that
`0001_identity.sql` is supposed to create. This blocks the 0024
promote and is almost certainly the root cause behind dry-run failures
observed earlier on Day-26.

## What was found — diagnostic query results (production DB, project `qdotjmwqbyzldfuxphei`)

- `set_updated_at()` function: **ABSENT** (0 rows in `pg_proc`)
- Only `updated_at` trigger on the DB: `update_objects_updated_at` on
  the `objects` table — that is Supabase Storage's internal table, not
  ours
- `public.tenants`: **ABSENT** (does not exist in any form — confirmed
  via `pg_class` with no relkind filter)
- `public.roles`: **ABSENT**
- `public.role_assignments`: **ABSENT**
- `public.api_keys`: **ABSENT**
- `public.users`: **EXISTS** as an ordinary table, BUT missing its
  `updated_at` column (repo `0001` line 110 says it should have one)
- `auth.users`: exists — that is Supabase's own auth table, expected,
  irrelevant to this

The 0024 migration attempt itself rolled back cleanly (Supabase SQL
editor wraps multi-statement pastes in a transaction; it failed on the
`CREATE TRIGGER` line referencing the absent `set_updated_at()` and
undid everything). Production schema is currently **UNTOUCHED** by the
0024 attempt — every query after the failed attempt was read-only.

## Connection to Day-26 dry-run findings

Aqib's dry runs on Day-26 surfaced:

- no way to select a tenant (e.g. `transcorpsb` vs `transcorpuae`)
  when creating users;
- a merchant mapped on SuiteFleet by `customerId` but with no
  authentication wired (neither OAuth nor Secret Key);
- no tasks generating because no authentication was in place.

The credentials lane (Sub-PRs 1–3, merged Day-26) is the CODE fix for
that gap — region selector, per-merchant credentials surface,
resolver, dual-path auth. But the lane's UI and resolver assume the
identity schema exists. If `public.tenants` does not exist on
production, there are no tenant rows to select because there is no
tenant table. **The absent-identity-schema problem and the dry-run
failures are the same problem viewed from two angles.**

## Open question that MUST be answered before any fix

Production has apparently been running the pilot. How, if
`public.tenants` / `roles` / `role_assignments` / `api_keys` do not
exist? Possible explanations — **none confirmed**:

- The pilot may have been running against a different database than
  the one queried tonight
- `0001` may never have been applied to this database, or applied
  then partially wiped
- There may be an environment/database-configuration issue not
  visible from schema queries

This question determines what the fix even is. It must be answered
first.

## What the next session must do — T3, audit → plan → execute

1. **Establish production's actual state and WHY**: full
   `information_schema` dump for the `public` schema vs the repo's
   migration ledger (0001–0023). Confirm whether the queried DB is the
   pilot DB. Determine why the identity schema is absent.
2. **Reconciliation plan-PR (T3)**: how to bring production's schema
   to match the repo migration history — in correct dependency order,
   accounting for `public.users` already existing WITH DATA (cannot
   naively re-run `0001`; it would collide). Reviewed as a plan before
   any SQL runs.
3. **Execution**: a reviewed reconciliation SQL block, run by Love in
   the Supabase SQL editor, verified.
4. **THEN** migration 0024 applies onto a confirmed foundation, and
   the credentials lane promote completes.

## Current state of the blocked work

- Credentials lane code (Sub-PRs 1/2/3) is **COMPLETE and merged** on
  main at `6392431`. That work stands and is correct.
- The Vercel promote of the Day-26 bundle is **BLOCKED** — Sub-PR 2/3
  runtime code reads identity-schema columns/tables that are absent on
  production. Production stays on its current deploy until
  reconciliation is done.
- Migration 0024 is **NOT applied** to production. Do not retry it
  until the reconciliation above is complete.

## Hard constraint

**No reconciliation SQL is to be pasted into production live or
improvised.** This is T3 plan-reviewed work. The Day-26 session
stopped the live SQL editor session deliberately at this point for
exactly this reason.
