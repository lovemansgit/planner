---
name: Branch-protection path-exemption runbook (docs-only PRs bypass Vercel required check legitimately)
description: Documents the vercel.json `ignoreCommand` mechanism that lets PRs touching only memory/, docs/, or *.md paths skip Vercel's preview deployment, causing Vercel to post a state=success status that satisfies the required-check binding without `--admin` bypass. Captures the four mechanisms considered, the empirical confirmation evidence, the path allowlist rationale, and the rollback procedure.
type: project
---

# Branch-protection path-exemption runbook

**What this changes:** docs-only PRs (touching only paths matching `^(memory/|docs/|.*\.md$)`) merge through the standard required-status-check flow instead of `gh pr merge --admin`.

**What it does NOT change:** branch protection rules on `main` and `production` are untouched. Required checks (`Vercel`, `lint + typecheck + test (unit)`) remain bound to their original `app_id`s. Non-docs PRs see no behavioral difference.

**Tier:** T1 (infra hygiene; no architectural surface; reversible by `git revert`).

---

## §1 Context

The `--admin` bypass drift was triple-confirmed across docs-only PRs #149, #150, and #156. Each time, `gh pr view` showed `mergeStateStatus: BLOCKED`, and merge proceeded via `gh pr merge --admin` rather than via a passing required check. The bypass works because `enforce_admins: false` on the protection rule, but each use is drift from the gate-clear posture that branch protection is meant to enforce.

The blocker on docs-only PRs is the `Vercel` required status check. Vercel deploys a preview on every PR push by default, and on a no-code-change diff, the deployment behavior is configuration-dependent — historically posting either pending-then-cancel or skipped without a corresponding `success` status. In any of those cases the required check fails to clear and the PR is BLOCKED.

This runbook records the resolution: a `vercel.json` `ignoreCommand` that exits 0 for docs-only diffs, causing Vercel to post `state=success` from its own app (app_id 8329), satisfying the required-check binding directly.

## §2 Mechanism

`vercel.json` adds an `ignoreCommand` key whose shell command:

1. Fetches `origin/main` shallowly (`--depth=50`)
2. Computes the merge-base between `origin/main` and `HEAD`
3. Lists files changed since the merge-base
4. If any file does NOT match `^(memory/|docs/|.*\.md$)`, exits 1 (build proceeds)
5. Otherwise (all files match), exits 0 (build skipped)

When `ignoreCommand` exits 0, Vercel:

- Sets the deployment state to `CANCELED` on Vercel's side
- Posts a GitHub commit status with `context=Vercel`, `state=success`, `description="Canceled by Ignored Build Step"` from `app_id=8329`
- The status satisfies the required-check binding `{context: "Vercel", app_id: 8329}` on `main` and `production`

The two surfaces (Vercel dashboard says CANCELED; GitHub says success) describe different layers and are both correct. The Vercel docs page covering the ignored-build-step behavior names the deployment-side state but does not document the GitHub-side mapping; the mapping was confirmed empirically before this PR was opened (see §4).

## §3 Decision rationale — four mechanisms considered

| Mechanism | Outcome | Reason |
|---|---|---|
| **(a)** GitHub Actions workflow posts a `success` status from a separate app_id | **REJECTED** | Required-check binding is `{context: "Vercel", app_id: 8329}`. Posting from `app_id 15368` (GitHub Actions) fails to satisfy the binding unless the rule is rebound to `app_id: -1` (any app). Rebinding opens a spoofing surface: any current or future workflow with `statuses: write` could post a `Vercel` `success` for non-docs PRs. The `Vercel` status would no longer mean "Vercel said the build passed" — it would mean "some workflow claimed it did." |
| **(b)** GitHub Rulesets with path-conditional required check | **REJECTED — INFEASIBLE** | Verified against the GitHub REST API reference (`/rest/repos/rules`): the `required_status_checks` rule schema accepts only `do_not_enforce_on_create`, `required_status_checks` array, and `strict_required_status_checks_policy`. The ruleset `conditions` block accepts only `ref_name.include` / `ref_name.exclude`. No path-based filter exists at any layer — neither on the rule nor on the conditions block. Path conditions in GitHub Rulesets exist solely for **Required Reviewers** (CODEOWNERS overlay), not for status checks. The mechanism cannot be implemented as conceptualized. |
| **(c)** Vercel `ignoreCommand` in vercel.json | **SELECTED** | Confirmed empirically (§4). Status posts from the correct app_id (8329), satisfies the required-check binding without protection-rule changes, no spoofing surface, single config-file change, fully reversible by `git revert`. Bonus: skips actual Vercel build for docs-only PRs (saves build minutes). |
| **(d)** Drop `Vercel` from required-check list | **REJECTED** | Surrenders build-time regression protection on every PR for hygiene-only gain. The `Vercel` check catches build-breaking changes that the `lint + typecheck + test` gate misses (e.g., next.config edge cases, framework-version regressions, runtime-only failures). Trading that for cleaner docs-only merges is bad math. |

## §4 Empirical evidence (PR #157 throwaway)

PR #157 (`day16/b2-vercel-ignorecommand-probe`, opened and closed 2026-05-06 morning) tested mechanism (c) before authorizing the real change. The throwaway PR added `"ignoreCommand": "exit 0"` to vercel.json — forcing the skip path unconditionally — and observed the resulting GitHub status.

| Field | Value |
|---|---|
| Status context | `Vercel` (matches required-check name) |
| State | `success` |
| Description | `Canceled by Ignored Build Step` |
| Posted by | `app_id 8329` (Vercel app — matches required-check binding) |
| `created_at` | 2026-05-06T07:05:53Z |
| Vercel target_url | `https://vercel.com/lovemansgits-projects/planner/Ddq64qKQNQLqauM2rwaXGVyyjsW8` |

PR #157 was closed and its branch deleted after observation. The PR itself was never merged; only the empirical observation was retained.

## §5 Path allowlist

Current scope: `^(memory/|docs/|.*\.md$)`.

| Pattern | Rationale |
|---|---|
| `memory/` | Auto-memory + handoffs + plans + decision memos + project files. By convention these never include executable code. The auto-memory contract (`/Users/lovemans/.claude/CLAUDE.md`) holds memory artifacts at this prefix. |
| `docs/` | Product docs (`docs/plan.docx`, `docs/Subscription_Planner_BRD_v1.docx`, etc.). Read-only artifacts surfaced through git for reviewer access. |
| `.*\.md$` | Top-level READMEs, CHANGELOGs, contributor guides. Same rationale as `docs/` — text-only, no runtime impact. The pattern matches `*.md` at any depth, which is intentional: every Markdown file in the repo is documentation, never code. |

The allowlist is **not** loaded from a separate file because the entire policy fits in a single regex and lives next to the mechanism. Adding a path requires a vercel.json edit + this section update; that's the same scope as a code change and is the right gate.

## §6 Rollback procedure

If `ignoreCommand` causes any regression — false positives (non-docs change wrongly skipped), false negatives (docs change wrongly built), or unexpected interaction with the Vercel deployment queue — rollback is one commit:

```bash
git revert <ignoreCommand-commit-sha>
git push origin main
```

The revert removes the `ignoreCommand` key from vercel.json. Vercel returns to the default behavior (build every commit). Branch-protection posture reverts to the pre-runbook state immediately on the next PR. `--admin` bypass for docs-only PRs becomes available again as a fallback while a different mechanism is investigated.

No state migration is needed — the change is purely declarative configuration. No DB rows, no env vars, no UI settings depend on this.

## §7 Caveats

- **Shallow fetch depth.** `git fetch origin main --depth=50` is sufficient for the current sprint cadence (main moves ~5–10 commits/day in active sprints). If the sprint rate climbs above ~50 commits between a feature branch's creation and its merge, the shallow fetch would not reach the merge-base and `git merge-base` would return empty — causing `git diff --name-only "" HEAD` to behave unexpectedly. **Watch:** if a docs-only PR ever shows the Vercel build proceeding instead of skipping, check the merge-base resolution first.

- **Bash one-liner JSON quoting.** The `ignoreCommand` value is a JSON string containing a shell command with internal double quotes and backslash-escaped regex characters. Future edits must preserve the escaping exactly. The pattern `\\.md$` in the JSON corresponds to `\.md$` in the actual regex — the doubled backslash is required because JSON unescapes one level before the shell sees the string.

- **CI workflow runs unchanged on docs-only PRs.** [.github/workflows/ci.yml](.github/workflows/ci.yml) does NOT have `paths-ignore` configured, so the `lint + typecheck + test (unit)` and `test (integration)` jobs still run on docs-only PRs. They pass cleanly (no code changed → no test or typecheck differences) but consume CI minutes and add ~3–5 min latency to docs-only merges. A future hygiene improvement could add `paths-ignore` to ci.yml — that's a separate PR with its own scope (and would introduce a dual source of truth for the path allowlist; both files would need to stay in sync). **Not in scope here.**

- **Path filter lives only in vercel.json.** No other system reads the allowlist. If the allowlist ever grows beyond what fits comfortably in a regex, factor it out — but until then, single source of truth in one config file is the simpler shape.

- **Production branch.** The same mechanism applies to PRs targeting `production` (e.g., promote-to-prod PRs that include only memory/ updates). In practice, promote-to-prod PRs always include code changes, so the docs-only path is unlikely to fire there — but the regex is branch-agnostic and works correctly if it ever does.
