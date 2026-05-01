---
name: Day 8 schedule note — calendar mapping and commit plan
description: Reference note for future-Claude reading the canonical plan documents. Calendar Day 8 (3 May 2026) maps to plan Day 10 per Day-7 drift note. Captures the Day 8 commit list, tier mix, and pace posture at the moment Day 8 work begins.
type: project
---

# Day 8 schedule note

**Captured:** 3 May 2026 (Day 8 calendar morning, pre-work)
**Source documents:** `docs/plan.docx` (canonical 14-day plan), `docs/plan-resolutions.docx` (resolutions addendum), Day-8 bootstrap brief from outgoing Claude Code session
**Why this exists:** Future-Claude reading plan documents will see "Day 8" content that does not match what calendar Day 8 actually shipped. This note pins the mapping for Day 8 specifically; the Day-7 drift note (`memory/notes/day7_schedule_drift.md`) covers the cumulative drift through Day 7 close.

---

## Calendar mapping

| Calendar | Plan-Day equivalent | Plan content slated | Plan content actually queued |
|---|---|---|---|
| Day 8 (3 May 2026) | Plan Day 10 | (operations / SF integration deepening per cumulative drift) | C-3 cron bulk push + DLQ admin UI + label passthrough + webhook auth/payload hardening + MP-13 cascade-cancel |

Calendar Day 8 ≈ Plan Day 10. The drift accumulated through Day 7 carries forward unchanged.

Trust git log + EOD handoffs for what shipped when. Plan content remains the canonical scope spec; only the calendar mapping is loose.

## Day 8 commit plan (target: 8–10 commits)

### Core (must land Day 8)

| # | Commit | Tier | Scope |
|---|---|---|---|
| D8-1 | Day 8 schedule note + createBulk-vs-single-loop status capture | T1 | this commit |
| D8-2 | Schema cluster — `consignees.district` + `tenants.suitefleet_customer_code` + `tenant_suitefleet_webhook_credentials` table | T3 | heaviest schema commit of pilot to date; three logical sections in one migration |
| D8-3 | Contract relaxation — `DeliveryAddress.latitude`/`longitude` optional + `buildLocation` conditional spreads | T2 | mirrors existing `district` conditional pattern |
| D8-4 | C-3 cron bulk push to SF + DLQ + 23505 reconcile via AWB regex | T3 | second-heaviest commit; single-loop locked default; throttle at LastMileAdapter, not cron route |
| D8-5 | DLQ retry service + `/admin/failed-pushes` UI + `failed_pushes:retry` permission | T2 | depends on D8-4 |
| D8-6 | Label passthrough — `POST /api/tasks/labels` + `task:print_labels` + `task.labels_printed` audit event | T2 | server-side fetch only; token-in-query never reaches operator browsers |
| D8-7 | Day 8 EOD handoff scaffolding (skeleton mid-day, fill EOD) | T1 | mirrors C-5 pattern from Day 7 |

### Optional (slot Day 9 if pace tight)

| # | Commit | Tier | Trigger to defer |
|---|---|---|---|
| D8-8 | Webhook receiver hardening — auth check + array-body parse + action-based routing | T3 | third T3 of the day; defer if D8-2 or D8-4 burned more context than budgeted |
| D8-9 | Webhook credentials admin UI — generate/display-once/rotate flow | T2 | depends on D8-8 schema; defer if D8-8 deferred |
| D8-10 | MP-13 cascade-cancel — Option A soft-delete via `consignees.deactivated_at` | T3 | fourth T3; assess at end of Day 8 |

## Tier mix

- Core: 2 T1, 3 T2, 2 T3
- All optional: +1 T2, +2 T3 (max-day total: 2 T1, 4 T2, 4 T3)
- Two hard-stop-twice T3 commits guaranteed in core (D8-2, D8-4); up to two more if all optionals land

## Pace posture

- Heavy day by T3 count. Two hard-stop-twice T3s in core; up to four T3s if all optionals land.
- **Mid-day handoff trigger:** if context drops below 25% during D8-2 or D8-4, surface to Love before opening the next T3.
- Day 8 inlining standing rule (Day 8 only — reassess Day 9): T3 PRs ship full inline of load-bearing files in initial PR-open message. T2 PRs ship summary; reviewer asks for specific inlines. T1 ships summary only.

## Outstanding pre-D8-4 question

- **createBulk vs single-loop**: open as of Day 8 morning. Love going to SF directly for response shape confirmation. Single-loop is the locked default; createBulk only acceptable if SF confirms per-task SF task IDs on success AND per-task 23505 on conflict. Captured in `memory/followup_createbulk_vs_single_loop.md`.

## What is NOT in scope today

- Sweeper cron infrastructure (Day 12 per plan) — C-8 service-layer landed Day 7; cron handler still queued
- Sentry custom dashboards / measurements (Day 11 per plan)
- Webhook telemetry surfacing (delivery photos, signature, ratings) — capture-but-don't-render is the Day-8 webhook hardening posture if D8-8 lands; UI surfacing is post-pilot
