---
name: Push-handler route header comment under-counts outcome enum (10 vs actual 11)
description: src/app/api/queue/push-task/route.ts header comments at line 12 and line 62 describe the outcome enum as "10-value", but the actual TypeScript union type at lines 72-83 has 11 members. Header comment under-counts by one — likely "task_not_found" was counted as collapsing into the pre-call defensive case but the type retains it as a distinct value. Cosmetic drift; no runtime impact.
type: project
---

# Push-handler route header outcome-enum under-count

**Surfaced:** Day 16 morning, plan-sync bundle staging (Block 3 sub-task B).

**Drift:** `src/app/api/queue/push-task/route.ts:12` and `:62` header comments say "10-value outcome enum"; the live TypeScript union at `:72-83` has 11 members. Day-15 EOD §3.1 framing of "11-state observability outcome enum" matches the actual type, not the header comments.

**11 enum members (canonical, per the TypeScript union):**

1. `tenant_mismatch_rejected`
2. `address_id_null_rejected`
3. `task_already_pushed_pre_check`
4. `success`
5. `awb_exists_reconciled`
6. `awb_reconcile_failed_retry_throw`
7. `failed_to_dlq`
8. `skipped_district`
9. `tenant_skipped_no_credentials`
10. `task_already_pushed_in_push`
11. `task_not_found`

**Fix:** trivial header-comment update — `10-value` → `11-value` at both line references. T1 code-fixup PR, separate from this bundle.

**Why not folded into the plan-sync bundle:** plan-sync bundle is docs/scripts only; this is a `.ts` source-file edit. Different scope, different review surface (would trigger Vercel build path on a 2-line cosmetic diff). Filing as followup so it isn't lost.
