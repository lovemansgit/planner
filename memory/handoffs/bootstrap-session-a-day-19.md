# Session A bootstrap — Day-19 morning

**For:** fresh Session A successor at Day-19 window open
**Repo:** `lovemansgit/planner`
**Read first:** `memory/handoffs/day-18-eod.md` (canonical Day-18 closing state). This brief covers only Session-A-specific operational knowledge — most context lives in the EOD doc + brief + index + memos. Cross-references in §6.

---

## §1 Worktree pattern

- **Worktree path:** main worktree at `/Users/lovemans/Code/planner` (Session A operates in main; Session B operates separately at `~/work/planner-b` per its own pattern — confirm with reviewer if Session B is co-active).
- **Branch naming convention used today:** `day18/<scope>` (e.g. `day18/a1-customer-id-resolver-swap-code`, `day18/test-tenants-cleanup-pm`, `day18/eod-doc`). Day-19 successor switches to `day19/<scope>`.
- **Standard merge cycle:** `gh pr merge <#> --squash --delete-branch --repo lovemansgit/planner` → `git checkout main && git pull origin main --ff-only` → `git branch -D <local-branch>` → verify remote deletion via `git ls-remote --heads origin <branch>`.
- **CI poll pattern (memory-only PRs):** lint+typecheck+test(unit) is the gating signal; integration suite is path-exempt for `memory/`, `docs/`, `*.md`. Vercel + Vercel Preview Comments are status-only (don't block).

---

## §2 Environment knowledge

`.env.local` exists at repo root with these variable **names** (values redacted; never paste):

```
SUPABASE_DATABASE_URL              # superuser pool, BYPASSRLS
SUPABASE_APP_DATABASE_URL          # planner_app pool, NOBYPASSRLS
SUITEFLEET_SANDBOX_USERNAME
SUITEFLEET_SANDBOX_PASSWORD
SUITEFLEET_SANDBOX_CLIENT_ID       # 'transcorpsb' — region credential
SUITEFLEET_SANDBOX_CUSTOMER_ID     # 588 — pre-A1 fallback; resolver no longer reads
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY          # admin Auth API key
```

**NOT in `.env.local`** (do not assume reachable session-side):
- `MPL_ADMIN_PASSWORD`, `DNR_ADMIN_PASSWORD`, `FBU_ADMIN_PASSWORD`, `transcorp-admin@planner.test` password — operator credentials. If acting-as-operator is required, surface to reviewer per Gate-18 precedent rather than asking for the password.
- `QSTASH_TOKEN`, `QSTASH_FLOW_CONTROL_KEY` — queue enqueue requires this; without it, you cannot publish to `/api/queue/push-task` directly. Production cron path uses these on Vercel side.
- `CRON_SECRET` — `/api/cron/generate-tasks` is gated by `Bearer ${CRON_SECRET}`; without it, you cannot trigger the cron handler manually.

**Direct DB writes via service role:** the `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_DATABASE_URL` pair lets you read/write anything. Use sparingly and only when the path-via-runtime would be the same end state. Pattern reference: `scripts/onboard-merchant.mjs`, `scripts/onboard-transcorp-sysadmin.mjs`, the one-off node script that applied Migration 0022 (Day-18 EOD §8.7 — script deleted post-execution per discipline).

**TypeScript execution:** `npx tsx <file>` works for `.ts` / `.mts`. Note Node v24's experimental TS-strip mode does NOT handle re-exports cleanly — direct imports from source files (skip barrels) are the workaround. For test-flow execution, prefer running a vitest spec under `tests/sandbox/` (env loads via shell-source `.env.local` first; vitest doesn't auto-load).

---

## §3 Active state at Day-19 entry

- **main HEAD:** `66bd44e` (post-PR-#201 EOD doc merge).
- **Production HEAD:** `4e0b3c5` (PR #192 / A1 chunk; promoted Day-18 12:25 +0400).
- **Production queue:** 9 commits queued for next batched promote (#193 through #201) — standing one-promote-per-day cadence; expected Day-19 morning push.
- **Working tree:** clean (only untracked `.claude/` plugin dir, ignored).
- **One-off scripts cleaned up:** `scripts/gate-18-smoke.mjs`, `scripts/gate-18-wire-smoke.mts`, `tests/sandbox/gate-18-wire-smoke.spec.ts`, the Migration-0022-application script — all deleted post-execution.
- **Test-tenants leak recurrence:** every CI integration suite run leaks 50-70 tenant rows to production via `withServiceRole seedTenant()` + audit-RULE-blocked teardown DELETE. Manual archive-on-merge PR pattern is the temporary mitigation (PR #191 + #197 archived 439 rows in two batches). Phase 2 fix tracked at `memory/followup_ci_test_tenants_recurrence.md`.

---

## §4 Day-19 first-task carries

### §4.1 T1 audit_events column reference fix-up — DO BEFORE A2 production smoke

PR #200's webhook integration tests reference a non-existent `audit_events.created_at` column. Actual column is `occurred_at` (`supabase/migrations/0002_audit.sql:28`). 5 occurrences across 2 spec files — verified line numbers:

| File | Lines |
|---|---|
| `tests/integration/webhook-status-event-applied.spec.ts` | `140`, `308` |
| `tests/integration/webhook-edit-event-applied.spec.ts` | `127`, `220`, `262` |

Replace `ORDER BY created_at` → `ORDER BY occurred_at` at all 5 sites. Production code (`apply-webhook-edit-event.ts`, `apply-webhook-status-event.ts`) is **unaffected** — the bug is test-only. Estimated 10 min including CI verify.

**Caveat:** PR #200's CI run also showed 1 failing test in `tests/integration/webhook-pod-received.spec.ts` — but that file has NO `created_at` references. Different root cause. After fixing the 5 substitutions above, re-run integration suite and check whether `webhook-pod-received` greens up automatically (it may have been failing because of a cascade dependency on the other failing tests). If not, separate diagnosis needed before A2 production smoke.

### §4.2 Day-19 batched Vercel promote — 9 commits queued

Push to Production via `vercel promote <preview-deployment-id>` for the latest main HEAD's preview (or via dashboard). Reviewer typically signals when Love is ready. Don't auto-promote — reviewer pattern for production-promote is explicit-instruction-only.

### §4.3 A2 production smoke (Day-19 morning, A2 plan §10 step 7)

Per A2 plan §6 gate checklist:
- Trigger SF webhook event → verify `webhook_events` row inserted
- Verify `tasks.internal_status` flip via `apply-webhook-status-event`
- Verify `audit_events` row written per new event-types catalog (`task.status_changed_via_webhook`, `task.pod_received_via_webhook`, `task.edit_applied_via_webhook`)

Three trigger paths:
- (a) Wait for real SF cron-generated webhook traffic (slow, demo-day uncertain timing)
- (b) Aqib-initiated test event (coordination required)
- (c) Direct POST to receiver with valid payload + signature (path-exempt to Tier-1 if sandbox; per A2 plan)

Estimated 30-45 min depending on path.

### §4.4 SF sandbox task `MPL-14794527` / id `61027` cleanup with Aqib

Day-18 Gate-18 leftover smoke task. Sandbox, low-risk, low-priority. Aqib coordination tomorrow.

---

## §5 Discipline notes

- **Force-push requires PRE-authorization, not retroactive.** Even `--force-with-lease`. Rule violated PR #192 era; saved at `memory/feedback_force_push_requires_pre_authorization.md`. Pattern: surface → authorize → act, not the inverse.
- **Migration application via CLI script is convention-adapted, not deviation** (per Day-18 EOD §8.7). Use `SUPABASE_DATABASE_URL` pattern mirroring `scripts/post-deploy-verify.mjs`. Pre-flight + post-flight + EXPLAIN smoke verify. One-shot script; delete post-execution.
- **Reviewer holds full counter-review responsibility for PRs.** Never punt review work to Love. Reviewer rules; reviewer authorizes; agent acts.
- **Credentials never paste in chat or commits.** If a credential is needed (operator password, QSTASH_TOKEN, CRON_SECRET), surface the gap rather than ask Love to paste; reviewer routes the path-forward.
- **Soft-archive over DELETE for production cleanup.** Convention from PR #191: `status='archived'` for tenants; analogous per-table soft-archive markers (`internal_status='CANCELED'` for tasks, `crm_state='CHURNED'` for consignees per brief §3.3.2). Hook will catch DELETE deviation (Day-18 §8.2 incident).
- **Slug correction (Day-18 ground truth):** demo tenant slugs are `meal-plan-scheduler` / `dr-nutrition` / `fresh-butchers` — NOT `mpl` / `dnr` / `fbu` (those are the customer_code labels and AWB prefixes, not slugs). `transcorp` is the dedicated sysadmin home tenant.

---

## §6 Cross-references for fresh-window resume

Read in this order:

1. **`memory/handoffs/day-18-eod.md`** — canonical Day-18 closing state; PR ledger, decisions locked, gate verdicts, carry-forwards (this brief points back here for everything not Session-A-specific).
2. **`memory/PLANNER_PRODUCT_BRIEF.md`** — currently v1.8 (post PR #199). v1.7 amendment at `memory/decision_brief_v1_7_amendment_sf_identifier_model.md`. v1.8 amendment in PR #199 inline.
3. **`memory/MEMORY.md`** — index; reflects Day-18 entries through PR #198 (Day-18 backfill of #199-#201 entries is a Day-19 T1 carry-forward — pre-existing pattern; same gap exists for Day-17 PRs #168-#185).
4. **`memory/plans/day-18-a2-webhook-handler-3-layer.md`** — A2 plan canonical; §6 gate checklist + §10 sequencing for Day-19 production smoke.
5. **`memory/followup_asset_tracking_phase_2.md`** — asset tracking out of MVP, dormant infra stays.
6. **`memory/followup_transcorp_admin_global_view_phase_1_5.md`** — Phase 1.5 cross-tenant admin sequenced May 15 → May 18 window.
7. **`memory/followup_ci_test_tenants_recurrence.md`** — recurrence pattern memo + Phase 2 paths ranked.
8. **`memory/followup_a1_plan_section_2_5_premise_correction.md`** — Pattern-B rationale for keeping the task-push race-condition-belt guard.
9. **`memory/followup_admin_merchant_list_filter_internal_tenant.md`** — `is_internal` flag deferred to Phase 2.

---

**End of bootstrap brief.** Total read time ≈ 5 min. After absorbing, surface verbatim line: "Bootstrap absorbed. Main HEAD verified at <SHA>. Standing by for Day-19 first task."
