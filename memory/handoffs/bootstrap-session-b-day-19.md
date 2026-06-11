---
name: Session B Day-19 bootstrap brief
description: Fresh Session B resume context for Day 19 (May 9 2026). A2 plan-PR + code-PR merged Day 18; migration 0022 applied to production; production smoke deferred to Day 19. T1 audit_events column-reference fix-up is the load-bearing first task before smoke. UI surfaces code-PR (tasks-page bag-icon + calendar inline POD) carries forward per plan §6.4.
type: project
---

# Session B — Day-19 bootstrap (lean)

Read this in full + skim §6 cross-refs as needed. Fresh successor reads in ~5 min.

## §1 Worktree pattern

- **Worktree:** `~/work/planner-b`. Detached HEAD on origin/main at session start.
- **Per-call git pattern:** `git -C ~/work/planner-b <cmd>` from any cwd, OR `cd ~/work/planner-b && <cmd>` chained. Absolute paths for file edits.
- **Detached-HEAD anchor convention:** at start of a new task, `git -C ~/work/planner-b fetch origin && git -C ~/work/planner-b checkout -b day19/<scope> origin/main`. Worktree merge brittleness fallback after PR merge: `git -C ~/work/planner-b checkout --detach origin/main && git -C ~/work/planner-b branch -D day19/<scope>` (origin auto-deletes on `gh pr merge --delete-branch`; local branch survives the worktree-merge race).
- **Branch naming convention** (Day-18 examples): `day18/a2-prep-memos`, `day18/a2-webhook-handler-plan`, `day18/a2-webhook-handler-code`, `day18/session-b-bootstrap`. Day 19: `day19/<scope>`.

## §2 Environment knowledge

`.env.local` exists at `~/work/planner-b/.env.local` and points at the **production project `qdotjmwqbyzldfuxphei`** (Vercel deployment `planner-olive-sigma.vercel.app`). Variable NAMES present:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_DATABASE_URL` (superuser pool, BYPASSRLS)
- `SUPABASE_APP_DATABASE_URL` (planner_app pool, NOBYPASSRLS)
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUITEFLEET_SANDBOX_USERNAME`
- `SUITEFLEET_SANDBOX_PASSWORD`
- `SUITEFLEET_SANDBOX_CLIENT_ID`
- `SUITEFLEET_SANDBOX_CUSTOMER_ID`

**Not in `.env.local`** (same gaps as Session A): operator login passwords (Supabase Auth users seeded out-of-band), `QSTASH_TOKEN`, `CRON_SECRET`. Get from Vercel env via Love if needed.

**Never paste credentials** in PR bodies, commit messages, plan/EOD docs, or memory files.

## §3 Active state at decommission

- Main HEAD at decommission: `66bd44e` (Day-18 EOD handoff #201).
- Migration 0022 applied to production at 2026-05-08T16:33:40.156Z. Verified clean: 10 columns present, all nullable, no defaults.
- Worktree clean idle. One-off `apply-0022-once.mjs` deleted post-execution; never committed.

## §4 Day-19 first-task carries (load-bearing pickup)

In sequence:

1. **T1 audit_events column-reference fix-up** — 5 `ORDER BY created_at` substitutions → `ORDER BY occurred_at` in two test files (`tests/integration/webhook-status-event-applied.spec.ts` lines 140 + 308; `tests/integration/webhook-edit-event-applied.spec.ts` lines 127 + 220 + 262). Pure test-only bug. Production code is correct. Confirmed schema check Day-18 against migration 0002_audit.sql: `audit_events.occurred_at` (not `created_at`). MUST land before A2 smoke.

2. **A2 production smoke** — per plan §10 step 7. Trigger SF event against demo tenant (sandbox-588 cron-generated task progressing through SF lifecycle, OR Aqib coordination). Verify:
   - `webhook_events` row written
   - `tasks.internal_status` flipped on matching `external_id` (AWB)
   - `audit_events` carries the `task.status_changed_via_webhook` row

3. **UI surfaces code-PR** per plan §6.4 (~1-1.5 hr):
   - Tasks-page POD column (last position) — blue+green bag-silhouette icon. NULL → muted; populated → active + click-to-modal lightbox.
   - Calendar week-card inline POD thumbnail (~64×64) when `pod_photos` non-null AND `internal_status === 'DELIVERED'`. Click → shared modal with §6.1.
   - Schema + write path already landed in PR #200; UI consumes `tasks.pod_photos` jsonb directly (Option (A) plain string array per §4.4 ruling).

Either Session A or Session B picks up #1 and #2; coordinate via main HEAD. UI surfaces (#3) is naturally Session B's lane (UI = Session B per parallel-session pattern).

## §5 Discipline notes

- **Migration 0022 application** was CLI-driven via one-shot Node script (postgres-js + `.env.local`'s `SUPABASE_DATABASE_URL`), NOT via Supabase web SQL editor. Reasoning: my environment can't drive a browser UI; the CLI path is the parallel for the convention. Per-statement gating + pre-flight + post-flight verification preserved. Filed in Day-18 EOD §8.7. Not a deviation; a convention adaptation.
- **§4.4 POD jsonb shape LOCKED Option (A)** plain string array. Code stores `deliveryInformation.photos` verbatim as jsonb (`JSON.stringify` preserves richer shape if SF wire is richer than strings). Wire-shape change is fixture+UI work, not Layer-2 code work.
- **Test-tenants leak recurrence** — see `memory/followup_ci_test_tenants_recurrence.md`. Integration tests seed `tenants` rows with random RUN_ID slugs; not auto-cleaned (audit_events_no_delete RULE blocks DELETE cascade per `memory/followup_audit_rule_cascade_conflict.md`). Periodic CI test-tenant archival is Phase-2 cleanup.
- **audit_events timestamp column is `occurred_at`, NOT `created_at`.** Production code (audit emit fn) relies on `DEFAULT now()` server-side; reads from tests must `ORDER BY occurred_at`. The Day-18 PR #200 specs got this wrong (5 instances) and the Day-19 first task is the fix-up.

## §6 Cross-references

- `memory/handoffs/day-18-eod.md` — Day-18 EOD doc with full landings.
- `memory/PLANNER_PRODUCT_BRIEF.md` — v1.8 (post-A2 plan-PR amendments).
- `memory/plans/day-18-a2-webhook-handler-3-layer.md` — A2 plan canonical.
- `memory/decision_layer_1_5_awb_only_extraction.md` — Layer 1.5 contract.
- `memory/followup_asset_tracking_phase_2.md` — asset-tracking deferral memo.
- `memory/followup_transcorp_admin_global_view_phase_1_5.md` — transcorp-staff admin global-view followup.
- `memory/followup_ci_test_tenants_recurrence.md` — CI test-tenants leak followup.
- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` — Layer-1 forensics (amended Day-18 PM).
- `supabase/migrations/0002_audit.sql` — `audit_events` schema (column-name fix reference).
- `supabase/migrations/0022_tasks_webhook_extracted_columns.sql` — applied to prod 2026-05-08T16:33:40.156Z.
