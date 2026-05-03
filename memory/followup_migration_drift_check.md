---
name: Migration drift between filesystem and live database
description: Migrations land in git via PR but are not auto-applied to Supabase — drift discovered during R-0 cutover when 0001/0002 had been merged but never run.
type: project
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
Day 2 cutover for R-0 (27 April 2026) surfaced that migrations 0001_identity.sql and 0002_audit.sql had been merged to main on Day 1 (PRs #11 and #12) but never actually applied to the live preview Supabase database. The Supabase Database screen showed only `auth.users`. Forward fix during the same R-0 cutover: pasted 0001 → 0002 → 0003 into the SQL editor in order.

**Why:** No Supabase CLI step in CI, no `drizzle-kit migrate` in the deploy pipeline, no Vercel build hook applies migrations. The bootstrap-notes pattern (commits 9 and 10 merged in browser) implied manual SQL-editor application but never made it explicit, and Day 1's `/hello` panels test Supabase connectivity rather than any specific table existence — green panels masked the gap. Migrations landing in git ≠ migrations landing on the database. Until this is closed, the file system and the database can diverge silently for any number of commits.

**How to apply:** Out of scope for the R-0 PR. After Day 2 lands (post C-21), open a small T2/T3 PR that adds a CI check comparing the filesystem migration count to the row count in `supabase_migrations.schema_migrations`. Suggested shape:

- A `scripts/check-migration-drift.ts` (or `.sh`) script that:
  - Counts files under `supabase/migrations/` matching `^[0-9]{4}_.*\.sql$`.
  - Connects to the database via `SUPABASE_DATABASE_URL` and runs `SELECT count(*) FROM supabase_migrations.schema_migrations;` (or whatever the actual Supabase migrations metadata table is — verify in dashboard first).
  - Exits non-zero on mismatch with a clear error naming both counts.
- A new step in `.github/workflows/ci.yml` after typecheck/lint that runs this script. Probably needs the `SUPABASE_DATABASE_URL` secret in GitHub Actions, scoped to read-only.
- Document the apply procedure in `docs/RUNBOOK.md` under a "Migrations" section: how to apply, how to verify, and what to do when CI flags drift.

Even tighter follow-up worth considering: switch to `drizzle-kit migrate` in CI so apply happens automatically on merge to main (preview DB) and on merge to production (production DB). The "migrations are SQL-editor pastes" model was fine for Day 1's bootstrap but does not scale to 14 days of changes.

**Surfaced:** R-0 cutover, 27 April 2026. Caught by Love noticing the empty `public` schema in the Supabase Database screen mid-cutover. Must not be forgotten — the drift hides quietly until something tries to query a missing table.
