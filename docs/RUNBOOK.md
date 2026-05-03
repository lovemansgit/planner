# Runbook

Operational reference. Day-2 scaffolding — sections fill in as systems land.
The full runbook is scheduled for Day 11 of the sprint; the deployment-topology
section below ships early because it is load-bearing for every Day-2+ commit.

---

## Deployment topology

### Branch model

| Branch           | Vercel environment | Purpose                                                        |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| `production`     | Production         | Live for the pilot. Only updated via promotion PR from `main`. |
| `main`           | Preview            | Integration trunk. All feature work merges here first.         |
| feature branches | Preview            | Per-PR previews.                                               |

**Why two long-lived branches.** Before R-0-prep, Vercel's production branch was `main`, so every merge to `main` shipped to the public Vercel URL — including auth-surface and database-role changes that needed observation time on a non-production env. R-0 (the BYPASSRLS hole closure) made this risk unignorable: a single merge to `main` would have rotated the database role under the live preview URL the team was demoing from. Splitting `production` off as a separate, manually-promoted branch puts a deliberate human step between integration and live traffic.

**Why `main` stays in the loop.** All PRs continue to target `main`; nothing routes around it. `main` is the source of truth for "what's been reviewed and integrated"; `production` is the source of truth for "what's currently serving live traffic." Promotion is a `git merge -X theirs origin/main` from a promote branch (after verifying the precondition `git log origin/main..origin/production` returns only prior squash-merge commits or known content-equivalent direct-push commits), followed by a squash-merge of the promotion PR. Per the Day-9 amendments captured in `memory/followup_promotion_runbook_first_execution_findings.md` and `memory/followup_promotion_runbook_addadd_conflict_pattern.md`, fast-forward is structurally impossible after any backport-via-PR cycle, and `-X theirs` is required for second-and-subsequent promotions. See `.github/workflows/promote-to-prod.md` for the step-by-step procedure (including hotfix variant + rollback).

### Vercel mapping

- **Production branch:** `production`. Only commits on this branch trigger a Production deployment to the public Vercel URL (currently `planner-olive-sigma.vercel.app`; will move to a custom domain pre-pilot).
- **Preview branches:** all other branches, including `main`. Each push gets a unique preview URL named `planner-git-<branch>-lovemansgits-projects.vercel.app`.
- **Environment variables:** every variable must be set in **Production AND Preview** scopes only — **NEVER Development**. Per `memory/feedback_vercel_env_scope_convention.md`. The Development scope on Vercel feeds `vercel dev` (Vercel's local-development command), which the project does not use — local development reads from `.env.local` files on each developer's machine instead. Setting a variable in Vercel's Development scope creates an unused-but-confusing artifact in the env-var inventory and can mask cases where `.env.local` is missing the variable. If a value legitimately differs between Production and Preview (rare for this project), document the divergence in `.env.example` AND set per-scope values via `vercel env add <NAME> <env>` (one invocation per scope).

### Branch protection

- `main` — PR-required, no approval (per bootstrap exception model). CI gate: GitHub Actions + Vercel preview both green.
- `production` — PR-required, no approval. CI gate: GitHub Actions green. The Vercel deployment that runs on merge IS the production deployment, so there is no pre-merge preview to validate against; pre-merge validation lives on `main`'s preview URL.

---

## Promotion to production

See `.github/workflows/promote-to-prod.md` for the step-by-step procedure. Summary:

1. PR lands on `main` → Vercel deploys a preview → validate.
2. When the preview is signed off, open a promotion PR from `main` to `production` using `git merge -X theirs origin/main` on a promote branch (after the precondition check — see runbook).
3. Squash-merge the promotion PR → Vercel deploys to Production → validate the public URL.
4. **Critical post-promotion step:** before starting any new feature branch, run `git checkout main && git pull origin main` (the local working branch is `production` after the promotion procedure; branching from there parents to production and produces `mergeable: CONFLICTING` PRs with skipped CI per `memory/followup_promotion_runbook_branch_state_risk.md`).

Hotfix variant: open a PR directly to `production` and a parallel backport PR to `main`. Same gate, same review pattern.

---

## Two-lane commit policy

All source-touching commits on this project follow a **two-lane policy** decided Day 9 morning during the auto-promote audit:

- **Lane 1 (substantive — T2 / T3):** any source / SQL / auth-surface / integration commit. After landing on `main`, Lane 1 work requires an explicit promotion PR to `production` per the runbook above. The promotion gate is the deliberate human-step between integration and live traffic that R-0-prep introduced.
- **Lane 2 (procedural — T1):** docs, memory, env vars, config, comment-only edits. Lane 2 work auto-merges to `main` on green CI and does NOT require a promotion to take effect — these commits don't change runtime behaviour, so production's git tree drifting from main on Lane-2-only diffs is operationally fine.

The split exists because requiring promotion for every memo / docs commit would impose ~5 min per T1 PR for zero operational benefit (memos don't change what runs in production). Lane 2's accumulated drift between promotions gets carried forward in batches at the next Lane-1 promotion — which, by design, is when the deliberate human-step matters anyway.

Cross-references:
- `.github/workflows/promote-to-prod.md` — the Lane-1 procedure
- `memory/followup_vercel_auto_promote_main_to_production.md` — the Day-8/9 audit that drove the Option C decision establishing this policy
- `memory/followup_branch_model_audit_results.md` — Day-9 EOD audit confirming the policy holds across the three layers (infrastructure / documentation / operator-mental-model)

---

## Bootstrap exceptions

Folded in from `docs/BOOTSTRAP_NOTES.md` on Day 11 of the sprint. Until then, see that file directly.

---

## Other sections (placeholders, fill on Day 11)

- Local development setup
- Database migrations (apply / rollback / new)
- Secrets rotation (Supabase, Upstash, AWS, Resend, Sentry, SuiteFleet)
- Incident response (Sentry alerts, Vercel logs, Supabase dashboard)
- Common operations (resend invitation, retry dead-letter, replay webhook)
