---
name: Vercel CLI 53.1.1 — `env add NAME preview` rejects all-branches form even with --yes
description: Vercel CLI 53.1.1 (and `vercel@latest` at the time of this filing) blocks `vercel env add NAME preview` and all CLI-recommended variants with `git_branch_required` action_required errors, even when --yes is passed. Production scope works via stdin pipe; Preview scope does not. Until upstream fix, fall back to Vercel dashboard for Preview-scope env-var adds.
type: followup
---

**Filed:** Day 14 EOD (5 May 2026), during §11.2 row 6 QSTASH_FLOW_CONTROL_KEY add for the cron-decoupling code PR.

## Failure mode

Vercel CLI 53.1.1 (and `vercel@latest`, same version at time of filing) rejects all three forms below for Preview scope, despite the CLI itself recommending these forms:
Form 1: stdin pipe (the form that worked for Production scope on the same project, same session)
printf "value" | vercel env add VAR_NAME preview
Form 2: --value + --yes (the CLI's own next[1] recommendation in its action_required JSON)
vercel env add VAR_NAME preview --value "value" --yes
Form 3: same as Form 2 with npx vercel@latest (53.1.1)
npx vercel@latest env add VAR_NAME preview --value "value" --yes

All three return identical `action_required` JSON with reason `git_branch_required`. The CLI is gating "set for all preview branches" behind a confirmation step that `--yes` does not actually bypass.

Production scope add works fine on the same project/session/CLI version using Form 1. The bug is Preview-scope-specific.

## Workaround

Fall back to Vercel dashboard:

1. Navigate to project Settings → Environment Variables → Add New
2. Fill: Key, Value, Environments = **Preview only**, Git Branch = **leave blank** (blank = all preview branches, which is the semantic the CLI was failing to set)
3. Save

Verify post-add: `vercel env ls | grep VAR_NAME` should show two rows (one per scope) when both Production and Preview are set. The two-row shape is dashboard-add output format vs CLI-add combined-row shape — functionally equivalent at the API layer (`target: ["preview"]` vs `target: ["production"]`).

## Why this isn't a convention violation

PR #149 (5 May 2026) corrected the execution convention to "Claude Code executes whatever has a programmatic path; Love does manual UI actions only when there is no programmatic path." A broken CLI on a specific subcommand version is functionally equivalent to "no CLI path exists right now" — the corrected convention's residual carve-out covers this exact case.

Future Claude Code sessions hitting the same bug should:
1. Attempt CLI add (Form 1 stdin pipe is the cleanest; try Form 2 with --yes if Form 1 fails with `action_required`)
2. If Preview scope returns `git_branch_required` despite --yes, fall back to dashboard
3. Surface this memo to Love rather than re-deriving the workaround

## Resolution path

Upstream Vercel CLI bug; not in our control. Pin to current CLI version and dashboard fallback until a release notes entry confirms fix. Worth re-testing the CLI Form 1 / Form 2 paths every few weeks.

## Cross-references

- PR #149 — convention correction including the residual UI-only carve-out
- `feedback_vercel_env_scope_convention.md` — Production + Preview only scope convention (still applies; this memo is about HOW to set them, not WHICH scopes)
