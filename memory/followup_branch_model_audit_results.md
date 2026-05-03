---
name: Branch-model audit results — Day 9 EOD (3 May 2026)
description: Three-layer sweep per memory/followup_branch_model_audit.md scope completed Day-9 EOD. Infrastructure layer clean. Operator-mental-model layer findings already captured in prior memos. Documentation layer surfaced TWO new findings — both docs-only, RUNBOOK.md wording drift. Drift B (env-scope contradiction) is load-bearing — RUNBOOK.md tells operators "Production AND Preview AND Development" but the locked convention is "Production + Preview only, never Development." Day-10 docs-pass batch must amend RUNBOOK.md alongside the existing 4-item docs-pass corpus. Decision boundary preserved: R-0-prep stays.
type: project
---

# Branch-model audit results — Day 9 EOD

**Captured:** 3 May 2026 (Day 9 EOD, post-PR #99 batched promotion)
**Audit scope:** `memory/followup_branch_model_audit.md` (filed Day 9 P9)
**Time spent:** ~30 min for the three-layer sweep + write-up
**Decision boundary preserved:** R-0-prep stays (Option A/B/C closed Day 9 morning)

---

## Audit corpus going in (5 prior findings)

1. Auto-promote memo misdiagnosis (Day 9 morning) — resolved via Option C two-lane policy
2. R-0-prep infrastructure incomplete (3 sub-findings: SHA divergence, ff-only impossibility, ci.yml branch-filter) — resolved Day 9 morning + afternoon (PRs #88, #89, #92)
3. Promotion-procedure-bypass via `vercel promote` (Day 8, 3x) — resolved by first end-to-end runbook execution (PR #91)
4. PR #93 → #94 close-and-reopen — branch-state risk captured in `followup_promotion_runbook_branch_state_risk.md`; Day-10 docs-pass amendment
5. Add/add conflict pattern (Day 9 EOD batched promotion) — captured in `followup_promotion_runbook_addadd_conflict_pattern.md`; Day-10 docs-pass amendment

---

## Infrastructure layer — CLEAN ✓

| Check | Result |
|---|---|
| **Workflow files (`.github/workflows/*.yml`)** | One file: `ci.yml`. Triggers `pull_request: branches: [main, production]` per Day-9 PR #92 fix. ✓ No other workflows exist. |
| **`main` branch protection** | `contexts=['Vercel', 'lint + typecheck + test (unit)']`, `strict=False`, `reviews=0`, `linear=False`, `force_push=False`. ✓ matches Day-9 morning audit set state. |
| **`production` branch protection** | `contexts=['Vercel', 'lint + typecheck + test (unit)']`, `strict=False`, `reviews=0`, `linear=True`, `force_push=False`. ✓ matches; intentional divergence on `linear=True`. |
| **Vercel env scope drift** | `SUITEFLEET_SANDBOX_CUSTOMER_ID` Preview + Production ✓; `ALLOW_DEMO_AUTH=true` Preview only ✓ (deliberate per demo-context production gate); `S3_WEBHOOK_ARCHIVE_PREFIX` Dev+Preview+Prod (pre-existing — captured in `followup_env_scope_s3_webhook_archive_prefix.md`). No NEW drift. |
| **Vercel project Production Branch** | Implicit confirmation via `vercel ls --prod` — only commits on `production` trigger Production deployments. PR #99 promotion produced new Production deploy (`planner-1csbjql0y`, Ready 30s). ✓ |
| **`vercel.json`** | Cron schedule only. No branch refs. ✓ |
| **grep for `main`-as-deployment-target in `.github/`, `docs/`, `scripts/`, `package.json`** | All matches accounted for; no stale "main = production" references. Documentation refs all correctly describe the post-R-0-prep model. |
| **Stale comments in code (`src/`, `supabase/`)** | Empty grep result for "main = production" / "every merge to main" patterns. D8-2 migration comment framing already captured in `followup_d8_2_migration_comment_framing.md`. ✓ no new stale comments. |

**Infrastructure layer: clean.** All Day-9 morning + afternoon fixes hold. No drift.

---

## Documentation layer — TWO new findings 🟡

### 🔴 Drift B (load-bearing) — RUNBOOK.md env-scope wording CONTRADICTS the locked convention

**`docs/RUNBOOK.md`, "Vercel mapping" section, "Environment variables" line:**

> *"Environment variables: every variable must be set in **Production AND Preview AND Development** scopes. Production-only or Preview-only values are a footgun; if a value legitimately differs by environment, document the divergence in `.env.example`."*

**Conflicts with `memory/feedback_vercel_env_scope_convention.md`:**

> *"server-side env vars on the planner project go in **Production + Preview only**, never Development. Development scope is reserved for `.env.local` on developer machines, not Vercel."*

**Why this matters:** RUNBOOK.md is the canonical doc operators read first. The wording at write-time (R-0-prep, 27 April 2026) was permissive ("set in all three scopes"); the convention got locked at R-0 cutover (per `feedback_vercel_env_scope_convention.md` "Surfaced: R-0 cutover, 27 April 2026") but RUNBOOK.md was never updated. An operator following RUNBOOK.md verbatim would create env vars in all three scopes — directly violating the convention. The pre-existing `S3_WEBHOOK_ARCHIVE_PREFIX` drift may have originated from this RUNBOOK.md wording (added 8 days ago, pre-convention-lock).

**Day-10 docs-pass amendment:**

Replace the RUNBOOK.md wording with:

> *"Environment variables: every variable must be set in **Production AND Preview** scopes only, NEVER Development. Development scope is reserved for `.env.local` on developer machines per `memory/feedback_vercel_env_scope_convention.md`. If a value legitimately differs by environment, document the divergence in `.env.example` AND set the per-scope values via `vercel env add <NAME> <env>` (one invocation per scope)."*

### 🟡 Drift A (minor) — RUNBOOK.md promotion-procedure wording doesn't reflect the amended runbook

**`docs/RUNBOOK.md`, "Why `main` stays in the loop" paragraph:**

> *"Promotion is a fast-forward (or merge) from `main` to `production` via a tracked PR — see `.github/workflows/promote-to-prod.md`."*

**Conflict (mild):** The "(or merge)" is permissive enough to cover the post-Day-9 amended flow (plain merge / `-X theirs`), but the wording reads as if fast-forward is the default with merge as the exception. The actual post-Day-9 reality is the inverse: plain merge is the default (ff-only is structurally impossible after any backport-via-PR cycle per finding #2; `-X theirs` is required for second-and-subsequent promotions per finding #5).

**Day-10 docs-pass amendment:**

Replace with:

> *"Promotion is a `git merge -X theirs origin/main` from a promote branch (after verifying the precondition per `memory/followup_promotion_runbook_addadd_conflict_pattern.md`) followed by a squash-merge of the promotion PR. See `.github/workflows/promote-to-prod.md` for the full procedure including hotfix variant + rollback."*

---

## Operator-mental-model layer — already captured ✓

No new findings. Pre-existing items already queued for Day-10 docs-pass:

- **Two-lane policy** (T1 = Lane 2 no promote, T2/T3 = Lane 1 promotion-PR) — confirmed lives only in memory/ (3 files reference it, no docs/* file does). Day-10 docs-pass: add a section to RUNBOOK.md OR a dedicated `docs/PROMOTION_LANES.md` (operator's pick).
- **`git checkout main` after promotion** — runbook step 5 + hotfix step 132 both have the command but neither calls out the branch-state risk explicitly. Day-10 docs-pass amendment per `followup_promotion_runbook_branch_state_risk.md`.
- **Operator-instinct caveat** — no "operator/instinct" wording in any deployment doc. The branch-model audit memo recommended an instinct-reset note in BOOTSTRAP_NOTES.md; standing recommendation, low priority.

---

## Day-10 docs-pass corpus (consolidated)

After this audit, the Day-10 docs-pass batch grows from 4 to 6 items. Bundle into a single T1 PR:

1. **`followup_d8_2_migration_comment_framing.md`** — D8-2 migration comment frames credentials as default; amend to Tier-2-only context
2. **`followup_promotion_runbook_branch_state_risk.md`** — runbook step 5 footnote on branch-state risk after promotion
3. **`followup_promotion_runbook_addadd_conflict_pattern.md`** — runbook standard-flow + footnote on `-X theirs` for second-and-subsequent promotions
4. **`followup_env_scope_s3_webhook_archive_prefix.md`** — `vercel env rm S3_WEBHOOK_ARCHIVE_PREFIX development` (env-side, not docs)
5. **🆕 RUNBOOK.md env-scope wording** — fix Drift B (load-bearing — directly contradicts the locked convention)
6. **🆕 RUNBOOK.md promotion-procedure wording** — align Drift A with the amended runbook
7. **(also)** — Two-lane policy documentation in RUNBOOK.md or dedicated file

All docs-only. No infrastructure-touching findings. No code/SQL changes required.

---

## Audit close — judgment

**Status:** **Surfaced fixes (2 new docs findings + 6-item consolidated docs-pass corpus).**

The audit's premise — "the model is correct, the supporting infrastructure and operator mental models aren't fully aligned" — held. The infrastructure layer is now fully aligned (Day 9 morning + afternoon fixes); the operator-mental-model layer's gaps were already known; the documentation layer surfaced 2 new wording-drift items that compound with the 4 already queued.

The most meaningful finding is **Drift B** (env-scope contradiction). RUNBOOK.md tells operators something the convention forbids. The pre-existing `S3_WEBHOOK_ARCHIVE_PREFIX` drift may have been seeded by this wording. Fix is one wording change in RUNBOOK.md.

The Day-10 docs-pass batch closes the alignment gap end-to-end. After that batch lands, the branch-model is fully documented at every layer.

**Decision boundary preserved:** R-0-prep stays. Audit closes alignment gaps within the chosen model, not re-litigating it.

---

## Cross-references

- `memory/followup_branch_model_audit.md` — audit scope (the 4-finding corpus going in)
- `memory/followup_promotion_runbook_first_execution_findings.md` — findings #1, #2, #3
- `memory/followup_promotion_runbook_branch_state_risk.md` — finding #4
- `memory/followup_promotion_runbook_addadd_conflict_pattern.md` — finding #5
- `memory/followup_d8_2_migration_comment_framing.md` — Day-10 docs-pass item #1
- `memory/followup_env_scope_s3_webhook_archive_prefix.md` — Day-10 docs-pass item #4 (env-side)
- `memory/feedback_vercel_env_scope_convention.md` — the convention RUNBOOK.md contradicts
- `memory/handoffs/day-9-eod.md` — Day-9 sprint summary; this audit is the Day-9-EOD-deferred Day-10 P1 priority
- `docs/RUNBOOK.md` — the documentation-layer audit target (2 wording drifts surfaced)
- `docs/BOOTSTRAP_NOTES.md` — clean ✓
- `.github/workflows/promote-to-prod.md` — the runbook itself; amendments per items #2, #3, #5, #6 above
- `.github/workflows/ci.yml` — clean post-Day-9 PR #92 ✓
