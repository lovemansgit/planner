---
name: Posture B retirement runbook (auth hard cutover — drops ALLOW_DEMO_AUTH fallback)
description: Step-by-step Vercel-UI-driven runbook for retiring Posture B (the demo-context fallback auth path) when the 48h soak window opens ~6 May ~5am Dubai. Two stages — Stage 1 is the env-var removal in Vercel UI (Love's action, no code touch); Stage 2 is the code-cleanup PR (Builder action, drops the fallback path + buildDemoContext + tests). Open questions at §6 — Love answers in the morning before executing.
type: project
---

# Posture B retirement runbook

**What this retires:** the `ALLOW_DEMO_AUTH=true` fallback path that lets Vercel Preview deploys fall through to the legacy `buildDemoContext` (first-tenant Tenant-Admin synthetic actor) when no real Supabase Auth session is present.

**What it does NOT retire:** real Supabase Auth (the primary path; in production since Day 10). Production has never had `ALLOW_DEMO_AUTH` set.

**Why now:** the 48h soak window after Day-10 P2 (auth landing per `memory/plans/auth_implementation_plan.md`) opens ~6 May ~5am Dubai. Soak proves real auth holds without the safety net; retirement removes the safety net.

**Tier:** T1 (operational + small code-cleanup PR; no architectural surface).

---

## §1 Pre-flight (Love confirms before Stage 1)

Before removing the env var, verify the soak window has produced clean signals:

| # | Check | Where | Expected |
|---|---|---|---|
| P1 | Day-10 P2 auth wiring landed in Production | git log on main | PR #104 merged commit visible (`e6b91f3` per `memory/handoffs/day-10-eod.md`) |
| P2 | 48h soak elapsed since Day-10 production deploy | Vercel Deployments → Production | Deploy timestamp ≥ 48h before now |
| P3 | Operator-side login flow exercised on Production at least once during soak | `SELECT COUNT(*) FROM audit_events WHERE event_type='user.login_succeeded' AND occurred_at > now() - interval '48 hours'` | ≥1 successful login from a real operator session |
| P4 | Zero `audit_events.event_type='user.login_failed'` rows that map to known operators in the soak window | `SELECT COUNT(*) FROM audit_events WHERE event_type='user.login_failed' AND occurred_at > now() - interval '48 hours'` | Zero, OR all counts trace to expected dev/test attempts |
| P5 | Three demo merchants (MPL → `meal-plan-scheduler`, DNR → `dr-nutrition`, FBU → `fresh-butchers`) each have ≥1 `tenant-admin` role-assignment | `SELECT t.slug, COUNT(*) FROM role_assignments ra JOIN roles r ON r.id = ra.role_id JOIN tenants t ON t.id = ra.tenant_id WHERE r.slug = 'tenant-admin' AND t.slug IN ('meal-plan-scheduler', 'dr-nutrition', 'fresh-butchers') GROUP BY t.slug ORDER BY t.slug` | Each of the three slugs returns ≥1 |
| P6 | No production code path that depends on the demo fallback (no NODE_ENV-bypass code is live) | grep main HEAD: `process.env.ALLOW_DEMO_AUTH` | Should appear only at `src/shared/request-context.ts:264` + `src/shared/demo-context.ts` (the gate it guards) |

If any pre-flight check fails: STOP, surface to Love, do not proceed to Stage 1.

**P5 query — amendment history (Day 14 morning, post-PR-#142):** the original query had two bugs that produced fail-open false-negatives:

1. **Slug literal mismatch.** The original `WHERE t.slug IN ('mpl', 'dnr', 'fbu')` used informal abbreviations from Day-8/Day-12 memos rather than canonical production slugs. Actual production slugs are `meal-plan-scheduler` / `dr-nutrition` / `fresh-butchers`. The MPL/DNR/FBU shorthand survives in section headers and decision memos for narrative simplicity but does not match the `tenants.slug` column.
2. **Join shape via `users.tenant_id`.** The original `JOIN users u ON u.id = ra.user_id JOIN tenants t ON t.id = u.tenant_id` joined tenants through users, but `role_assignments.tenant_id` is the canonical FK to tenants and is the column the RBAC layer reads against. Joining via users introduces a silent dependency on `users.tenant_id` being set correctly on every operator row — when that column is NULL or stale, the row drops out and the merchant falsely appears to have no tenant-admin. **This is fail-open semantics:** the absence of evidence becomes evidence of absence, and the runbook gate passes-then-fails when it should fail-then-fail. The amended query joins `tenants` directly via `role_assignments.tenant_id`, which is the FK the RBAC code path actually traverses, so the runbook check now exactly mirrors the runtime authorization path.

The amended query was probed against the production DB on Day 14 morning (main HEAD `4731553`): all three demo merchants returned 1 tenant-admin each (`meal-plan-scheduler` / `dr-nutrition` / `fresh-butchers`), confirming the substantive intent of the runbook P5 check. The original query's fail-open semantics caused this same probe to falsely report all three as MISSING, surfacing the bug at the moment the runbook was first executed.

---

## §2 Stage 1 — Vercel UI env-var removal (Love's action, ~2 min)

**What:** remove `ALLOW_DEMO_AUTH` from the Vercel Preview env scope. (Production scope never had it; nothing to remove there.)

**Steps:**

1. Open Vercel Dashboard → `lovemansgits-projects/planner` → **Settings** → **Environment Variables**.
2. Locate `ALLOW_DEMO_AUTH` in the list. Confirm it's scoped to **Preview** only (NOT Production). If it's also on Production, STOP — that's an unexpected drift; surface to Builder before continuing.
3. Click the **⋯** menu next to the entry → **Remove** (NOT just "Edit value to empty" — full removal is what `feedback_vercel_env_scope_convention.md` posture wants).
4. Confirm removal in the modal.
5. **Trigger a new Preview deploy** to materialize the change (Vercel applies env-var changes on the next deploy, not retroactively). Easiest path: push any small commit OR re-run the most recent Preview deploy from Vercel UI ("Redeploy" button).

**Verification (Love runs immediately after Stage 1):**

| # | Check | How |
|---|---|---|
| V1 | New Preview deploy completed | Vercel Deployments → see the new build at the top of the list |
| V2 | Preview deploy without auth session returns 401, NOT a fallthrough | In a fresh incognito window, hit any Preview URL gated by `(app)/` route group (e.g. `https://planner-<hash>.vercel.app/consignees`) without logging in. Expected: `401 Unauthorized` (or redirect to `/login`). Pre-Posture-B behavior was: page loaded with sandbox-588 demo data. |
| V3 | Preview deploy WITH a valid login session works as before | Log in to the same Preview deploy via `/login` with a known operator credential. Expected: lands on the operator home page; consignee/subscription data renders normally. |

If V2 still shows demo data: the env var removal didn't take effect — re-trigger the Preview deploy and re-verify. If still failing after a clean deploy, STOP and surface to Builder.

If V3 fails: real auth is broken. STOP, do NOT proceed to Stage 2, surface to Builder for diagnosis.

---

## §3 Stage 2 — Code-cleanup PR (Builder action, sequenced AFTER Stage 1 verification)

**What:** drop the `ALLOW_DEMO_AUTH` fallback code path + remove `buildDemoContext` + delete the `src/shared/demo-context.ts` file + remove the env-var entry from `.env.example` + clean up tests.

**When:** Builder opens this PR ONLY AFTER Love confirms Stage 1 V1+V2+V3 all green. Runbook surfaces this with explicit "OK to proceed to Stage 2" message from Love before Builder drafts.

**Files to touch** (anchored at main HEAD):

| File | Change |
|---|---|
| `src/shared/request-context.ts:13-14, :264-266` | Remove the comment block referencing `ALLOW_DEMO_AUTH`; remove the `if (process.env.ALLOW_DEMO_AUTH === "true")` fallthrough block; remove the `buildDemoContext` import |
| `src/shared/demo-context.ts` (entire file, 120 lines) | Delete the file |
| `src/shared/tests/request-context.spec.ts` | Remove the `falls through to demo context when no session AND ALLOW_DEMO_AUTH=true` test; keep + expand the `throws UnauthorizedError when no session AND no ALLOW_DEMO_AUTH opt-in` test (it becomes the canonical no-session behavior test); remove `beforeEach` env-var teardown for `ALLOW_DEMO_AUTH` |
| `.env.example` | Remove the `ALLOW_DEMO_AUTH=` entry + its surrounding comment block (per the doc note: "This variable disappears entirely once auth wiring lands.") |
| `src/app/(app)/consignees/page.tsx` (header comment) | Remove the comment header line referencing `ALLOW_DEMO_AUTH=true (Preview-only) until the Posture B follow-up` |
| `src/app/api/tasks/route.ts` (header comment) | Same — remove the fallthrough reference comment |
| `src/app/api/consignees/route.ts` (header comment) | Same |
| `src/app/api/subscriptions/route.ts` (header comment) | Same |

**Verification (CI):**

| Gate | Expected |
|---|---|
| `npm run typecheck` | Green — no remaining import of `buildDemoContext` |
| `npm run test` | Green — request-context.spec.ts test count drops by 1 (the falls-through test removed) |
| `npm run lint` | Green |
| Integration tests | Green (Posture B retirement does not touch DB layer) |

**Memory updates** in same PR:
- Update `memory/followup_probe_complete_day10.md` — verdict for step 7 of the cross-tenant probe changes from "Posture A fallthrough → sandbox-588 data" to "401 Unauthorized" per the file's existing note ("Posture B retirement — when the demo-context fallthrough is removed (T1 follow-up after ~48h soak), step 7's expected behavior changes...")
- Optional: tick `feedback_vercel_env_scope_convention.md` if any related drift surfaces during Stage 1 V2 verification

---

## §4 Rollback (if Stage 2 ships and breaks production)

Posture B retirement is a Production-no-op (Production never had `ALLOW_DEMO_AUTH`). The risk surface is Preview only.

If post-Stage-2 deploy breaks Preview auth:
1. **Immediate revert:** `git revert <stage-2-commit-sha>` on main; Vercel auto-redeploys
2. **Re-add the env var:** Vercel UI → restore `ALLOW_DEMO_AUTH=true` to Preview scope
3. Surface to Builder; re-diagnose with both stages reversed

Production is unaffected by the rollback because Production didn't depend on the fallback in the first place.

---

## §5 Cross-references

- `memory/plans/auth_implementation_plan.md` — Day-10 P2 auth plan that established Posture A → Posture B
- `memory/handoffs/day-10-eod.md` — handoff confirming Posture A landed
- `memory/followup_probe_complete_day10.md` — cross-tenant probe verdict that updates with Posture B retirement
- `memory/feedback_vercel_env_scope_convention.md` — Production + Preview only, never Development; reinforces the "Preview-only" posture for `ALLOW_DEMO_AUTH`
- `memory/followup_branch_model_audit_results.md` — env scope audit confirming `ALLOW_DEMO_AUTH=true Preview only` is the current posture
- `memory/followup_double_session_resolve_per_request.md` — Day-11 fix that touches `request-context.ts`; Stage 2's edits must not collide
- `src/shared/request-context.ts:264-266` — the fallthrough block to remove
- `src/shared/demo-context.ts` — the file to delete
- `.env.example` — the env-var doc to remove

---

## §6 Open questions for Love (answer in the morning before executing)

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Stage 1 → Stage 2 sequencing: should Builder open the Stage 2 code-cleanup PR **before** or **after** Stage 1 env-var removal? Two valid orderings: (a) Stage 1 first (env var gone, code path is dead but harmless until Stage 2 lands), (b) Stage 2 first (code path gone but env var lingering means Vercel UI still shows the var; remove via Stage 1 to clean up). | **(a) Stage 1 first**, then Stage 2 with confirmed-clean signals. Smaller blast radius — env var removal is reversible in 30s; code revert is a PR. |
| Q2 | Verification window between Stage 1 and Stage 2: how long after the V1+V2+V3 gates clear before Builder ships Stage 2? | **30 minutes** — long enough for any anomaly Sentry/log signal to surface; short enough not to lose the day. |
| Q3 | Should Stage 2 PR also retire the related `feedback_double_session_resolve_per_request.md` follow-up (the `ALLOW_DEMO_AUTH` reference at the file's L42)? | **Update the comment, do not delete the followup memo** — the followup tracks a separate Day-5 resolver concern that survives Posture B retirement. Just remove the now-obsolete inline reference. |
| Q4 | Does Love want Builder to draft the Stage 2 PR autonomously after Love's "Stage 1 done, OK to proceed" message, or does Love want to draft Stage 2 themselves? | **Builder drafts on Love's go-ahead** — the changes are mechanical (delete a file, remove a code block, trim tests). T1 per the Day-10 plan classification. |
| Q5 | Stage 2 commit-message convention: include a `Co-Authored-By` for Love (since Stage 1 is Love's action and Stage 2 is the paired cleanup) or keep the standard Builder-only attribution? | **Standard Builder-only** — Stage 1 doesn't generate a commit; the attribution stays clean. |
| Q6 | Should the code-cleanup PR auto-merge on green CI like this runbook PR, or require explicit Love approval? | **Require explicit approval** — Stage 2 deletes ~120 lines of source plus a test file; not auto-merge despite being T1 in the original Day-10 classification. |

If Love answers all six in the morning before either stage executes, the rest of the runbook is mechanical.
