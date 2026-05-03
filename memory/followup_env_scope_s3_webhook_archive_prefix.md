---
name: S3_WEBHOOK_ARCHIVE_PREFIX env-scope convention violation
description: Pre-existing Vercel env var scoped to Development + Preview + Production, diverging from the planner-project convention (Production + Preview only, never Development). Surfaced during Day 9 P2 webhook env-add audit. Out of scope for Day 9; Day 10 cleanup candidate.
type: project
---

# `S3_WEBHOOK_ARCHIVE_PREFIX` env-scope convention violation

**Surfaced:** 3 May 2026 (Day 9 P2 webhook env-add inventory)
**Source:** `npx vercel env ls` showed `S3_WEBHOOK_ARCHIVE_PREFIX  Encrypted  Development, Preview, Production  8d ago`

---

## The divergence

Per `memory/feedback_vercel_env_scope_convention.md`, server-side env vars on the planner project go in **Production + Preview only**, never Development. Development scope is reserved for `.env.local` on developer machines.

`S3_WEBHOOK_ARCHIVE_PREFIX` is currently scoped to all three (Development + Preview + Production) — added 8 days ago (~25 April 2026, pre-Day-1 by calendar reckoning, likely during the same R-0-prep / R-3 era when the SF webhook archive prefix was being staged).

Why: Why: This was added before R-0 cutover, when the convention may not have been load-bearing yet. The convention itself was surfaced and locked at R-0 cutover (27 April 2026 per the convention memo) — `S3_WEBHOOK_ARCHIVE_PREFIX` predates the lock by ~2 days.

How to apply: Day-10 cleanup batch. `vercel env rm S3_WEBHOOK_ARCHIVE_PREFIX development` removes the Development-scope copy without affecting Preview / Production values. No code change required — runtime code reads the var in Production and Preview only; Development scope was unused.

---

## Why this matters (low urgency)

- Doesn't break anything today: nothing reads the var in a Vercel-Development context (developers use `.env.local`, not Vercel-Development scope).
- Drift signal: future env-add operators may copy the bad pattern if it's the only one they see in `vercel env ls`. Cleanup keeps the convention enforced by inventory consistency.
- Pairs with any other Day-10 env-hygiene work (env-parity CI per `memory/followup_migration_drift_check.md` / day-8-eod §6 P2 deployment-pipeline gaps).

---

## Cross-references

- `memory/feedback_vercel_env_scope_convention.md` — the convention rule
- `memory/handoffs/day-8-eod.md` §6 — Day-9+ env-parity-CI item this folds into
- Day 9 P2 webhook env-add session (this commit's session) — the audit that surfaced the divergence
