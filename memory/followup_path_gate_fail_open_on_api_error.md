# Path-gate Layer 1 fails OPEN on GitHub API error

**Filed:** Day-52 overnight (10 Jun 2026), Session A, during the #365 park cycle.
**Status (Day-53 update):** Fix **approved by Love** (Day-53 morning clearances, `memory/decision_d53_morning_clearances.md`), **built and parked as PR #370** (opus APPROVE round 1, `parked-t2`) — verified live on five cases including both pre-fix fail-open shapes. Awaits Love's merge. Original filing below unchanged.

## What happened (observed live)

First `path-gate.sh 365` run during a transient network failure:

```
error connecting to api.github.com
AUTO_MERGE_ELIGIBLE
exit=0
```

PR #365 is a CODE PR (src/ + tests/ + scripts/). The correct classification — confirmed on immediate re-run once the network recovered — is `PARK` / exit 1.

## Mechanism

`scripts/orchestration/path-gate.sh` feeds the changed-file loop via process substitution:

```bash
while IFS= read -r f; do ... done < <(gh api "repos/$repo/pulls/$pr/files" --paginate --jq '.[].filename')
```

When `gh api` fails, the substitution produces zero lines, the loop body never runs, `park` stays `false`, and the script falls through to `AUTO_MERGE_ELIGIBLE`. `set -euo pipefail` does NOT catch failures inside `< <(...)` — the command's exit status is invisible to the parent shell. Net effect: **an empty-because-errored file list is indistinguishable from a genuinely docs-only-empty list, and the gate defaults to the permissive answer.**

This is the exact inverse of the script's own stated discipline ("a truncated list must never decide a merge" — the comment above the `--paginate` choice). An errored list decided one.

## Why it's contained (and why it still matters)

- **Contained:** the builder never merges; only the Action merges, and it re-computes the gate server-side from its own API view. A fail-open Layer 1 can at worst mislabel locally; the Action's re-gate parks it.
- **Still matters:** Layer 1's output also selects the reviewer model (`docs_reviewer` vs `code_reviewer`) and the builder's lane behavior. A network blip at classification time silently routes a code PR down the docs lane until the Action catches it — the seam holds, but one of its two layers is contributing noise instead of signal.

## Fix shape (for the ruling)

Capture the file list first and fail closed on error or emptiness-with-error:

```bash
files=$(gh api "repos/$repo/pulls/$pr/files" --paginate --jq '.[].filename') || { echo "PARK"; exit 1; }
```

(plus optionally: treat a zero-file PR as PARK — no legitimate PR has zero files). One-line change; rides any orchestration-touching lane Love clears. Orchestration scripts live off the docs allowlist, so the fix itself parks.

## Cross-references

- `scripts/orchestration/path-gate.sh` — the gate (loop at the process substitution).
- `scripts/orchestration/RUNBOOK.md` — Layer 1 / Layer 2 split; "What NEVER happens" relies on Layer 2 for the hard guarantee, which held.
- PR #365 ORCH-PARK comment — where this was first flagged to Love.
