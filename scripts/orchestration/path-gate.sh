#!/usr/bin/env bash
# Shape-3 orchestration — Layer 1 mechanical path gate (Fork 4, Love-ruled).
# v1 scope: DOCS-ONLY auto-merge. No model judgment anywhere in this file.
#
# This file owns ONE job: fetch the PR's trusted change-set (fail-closed) and
# hand it to the PURE classifier, docs-only-predicate.sh. The allowlist +
# extension-guard live there so the merge gate and the CI fast-lane share one
# source of truth and can never drift. Verdict (Day-57, Love ruling on #564):
#   Allowlist:  memory/**, docs/**, tasks/**, root-level *.md
#               — AND, under the trees, a documentation-class extension
#                 (extension-guard: a non-doc file under a trusted tree PARKS).
#   supabase/migrations/** -> ALWAYS park, plus SQL_TO_APPLY flag.
#   One file outside the allowlist -> PARK.
#
# Usage:  path-gate.sh <pr-number>
# Stdout: optional "SQL_TO_APPLY" line, then "AUTO_MERGE_ELIGIBLE" or "PARK".
# Exit:   0 = auto-merge eligible, 1 = park.
set -euo pipefail

pr="$1"
repo="lovemansgit/planner"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# gh api --paginate, NOT `gh pr view --json files` — the latter caps at 100
# files and a truncated list must never decide a merge.
#
# Day-53 fail-closed hardening (memory/followup_path_gate_fail_open_on_api_error.md,
# Love-approved Day-53): the file list is captured FIRST and the gate parks on
# any API error or an empty list. Previously the loop read from a process
# substitution, whose failure escapes `set -euo pipefail` — a gh network error
# produced zero lines, the loop never ran, and the gate fell through to
# AUTO_MERGE_ELIGIBLE for a code PR (observed live on #365, Day-52 overnight).
# An errored or empty list must never decide a merge: no legitimate PR has
# zero changed files, so emptiness is only ever an error symptom.
if ! files=$(gh api "repos/$repo/pulls/$pr/files" --paginate --jq '.[].filename'); then
  echo "PARK"
  exit 1
fi
if [ -z "$files" ]; then
  echo "PARK"
  exit 1
fi

# Classify via the shared pure predicate. `pipefail` propagates its exit code
# (0 = AUTO_MERGE_ELIGIBLE, 1 = PARK), and its stdout is this gate's stdout —
# the external contract above is unchanged.
printf '%s\n' "$files" | bash "$here/docs-only-predicate.sh"
