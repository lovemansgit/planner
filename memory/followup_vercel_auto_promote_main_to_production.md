---
name: Vercel auto-promote main → Production policy gap (PRIORITY ELEVATED)
description: Vercel auto-deploys main → Preview only, never to Production. Every urgent fix that lands on main requires a manual `vercel promote` (CLI) or UI click before it actually runs in Production. Hit twice in one day on Day 8 (D8-4a deploy-promote, β deploy-promote). No longer a "nice to have" — operational risk vector. Day 9+ priority.
type: project
---

# Vercel auto-promote main → Production — policy gap

**Captured:** 2 May 2026 (Day 8, β post-merge validation)
**Priority:** ELEVATED — hit twice in one day. Each urgent fix requires the same manual step. Operational risk vector.

---

## The gap

Vercel project setting `Auto-Promote Production` is **off** for `lovemansgits-projects/planner`. Auto-deploy on push to main lands at Preview only; Production stays on whatever deployment was last manually promoted.

Empirical evidence (Day 8, two distinct incidents):

1. **D8-4a deploy-promote (mid-day):** D8-4a merged at `60a797c`. Production was several days stale. Manual `vercel promote` required to put D8-4a code in Production before the third cron trigger could capture meaningful empirical data. Captured in `memory/followup_suitefleet_bulk_push_empirical.md` (gate #3 in the prerequisites chain).

2. **β deploy-promote (post-merge validation, ~17:00 UTC):** β merged at `3412d13`. Production was still `planner-n04cdgsyr` (D8-4a-only). Love's manual cron trigger fired against the OLD deployment, hit the 300s timeout walking 340 tenants — the exact failure mode β was designed to prevent. Required a second manual `vercel promote` before β could be live-validated.

Same pattern, same day. The gap is no longer hypothetical.

---

## Why this is operationally risky

- **Every urgent fix carries an invisible "+1 step" cost.** Code reaches main → CI green → merge → still doesn't run in Production until someone remembers to promote. The remembering is human; the cost of forgetting is whatever the fix was meant to prevent.
- **Validation cycles double in length.** First cron trigger fires against stale code, hits the bug we just fixed, surfaces a confusing failure → debug → realise it's a deployment-staleness issue → promote → second trigger → finally validate. Twice the cycle time, twice the cognitive cost, twice the chance the wrong issue gets diagnosed.
- **Tonight's scheduled cron at 12:00 UTC is the canary.** β filter must be in Production before then or the timeout fires again. β was MERGED on time but not LIVE on time without the manual promote step.
- **Pattern compounds across the pilot timeline.** D8-8 (webhook hardening), D8-5 (DLQ retry), D8-6 (label passthrough), D9 (env-parity CI, MP-13 schema) all follow main-merge sequences. Each one currently inherits this manual step.

---

## Two resolution paths

### Path A — Auto-promote ON

Toggle the Vercel project setting to auto-promote the latest main-built deployment to Production. Every main merge → Preview build (still) → Production alias updated atomically when the build is Ready.

**Pros:** zero cognitive overhead post-merge. The CI green = Live invariant restored.

**Cons:** any main-merge with a runtime regression that didn't surface in unit/integration tests goes Live immediately. Mitigations: deploy-time smoke tests, staged rollouts, or feature flags — none of which exist today in this project.

### Path B — Explicit gate, but instrumented

Keep auto-promote OFF, but add a **deploy-readiness checklist to every PR template** plus a **post-merge bot reminder** that pings the merger if the latest main commit hasn't been promoted within N minutes.

**Pros:** preserves current safety posture (manual review of each Production push).

**Cons:** the cost of this gap (today: 2 hits in one day) doesn't change much — the bot ping is just a louder version of the human-remembers step. Adds tooling investment without addressing the root cause.

### Lean recommendation

**Path A**, gated by **tests-must-be-green**. CI is the existing gate; it's already required to merge. Adding "auto-promote on green main" is just removing the human-in-the-loop step that's currently the only thing between merge and Production. The runtime-regression risk is a real concern but is better addressed by:

- Better deploy-time observability (Sentry-DSN-as-gate is already in place; healthcheck endpoints could land Day 9)
- Feature flags for risky changes (already a planned post-pilot capability)
- Staged rollouts via Vercel deployment regions (out of scope for pilot but documented as future)

Today's reality: every β-class fix is an emergency with a clock. Manual promote is the worst place to introduce gates.

**Decision is Love's.** Surface this memo at next Day 9 morning brief; bundle as a small T1 if Path A chosen (Vercel UI toggle, no code change). If Path B chosen, the PR-template + bot-reminder work is a Day 9+ T2.

---

## Cross-references

- `memory/followup_suitefleet_bulk_push_empirical.md` — first Day-8 incident (D8-4a deploy stale)
- `memory/handoffs/day-8-mid.md` §5 — Day 9 backlog, original "Production promotion policy" carry-forward queued
- `memory/feedback_vercel_env_scope_convention.md` — adjacent: env-var Production+Preview convention. Different concern, same project setting domain.
- `memory/feedback_claude_code_executes_default.md` — "Vercel CLI actions (env, deploy, promote): Claude Code does it. Per-action approval for production-affecting changes." Supports Path A — Claude Code already does the promote action when explicitly approved; auto-promote removes the per-action approval friction for routine main merges.

---

## Immediate-term workaround (until policy lands)

Until Path A or Path B is decided + implemented, the operational discipline is:

1. After every main-merge that affects production behaviour, **the merger or next-action-Claude promotes immediately**: `npx vercel promote https://<latest-preview>-lovemansgits-projects.vercel.app --yes`.
2. Verify the new Production deployment goes `● Ready` (typically 25-40s) before considering the merge "live".
3. Trigger any required validation (manual cron, healthcheck) AFTER the new Production is Ready, not before.

This adds two CLI commands per merge but closes the validation-cycle-doubling gap that hit β today.
