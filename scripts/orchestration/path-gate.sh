#!/usr/bin/env bash
# Shape-3 orchestration — Layer 1 mechanical path gate (Fork 4, Love-ruled).
# v1 scope: DOCS-ONLY auto-merge. No model judgment anywhere in this file.
#
# Allowlist: memory/**, docs/**, tasks/**, root-level *.md.
# One file outside the allowlist -> PARK.
# supabase/migrations/** -> ALWAYS park, plus SQL_TO_APPLY flag.
#
# Usage:  path-gate.sh <pr-number>
# Stdout: optional "SQL_TO_APPLY" line, then "AUTO_MERGE_ELIGIBLE" or "PARK".
# Exit:   0 = auto-merge eligible, 1 = park.
set -euo pipefail

pr="$1"
repo="lovemansgit/planner"
park=false
sql=false

# gh api --paginate, NOT `gh pr view --json files` — the latter caps at 100
# files and a truncated list must never decide a merge.
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    supabase/migrations/*) sql=true; park=true ;;
    memory/*|docs/*|tasks/*) ;;
    */*) park=true ;;
    *.md) ;;
    *) park=true ;;
  esac
done < <(gh api "repos/$repo/pulls/$pr/files" --paginate --jq '.[].filename')

$sql && echo "SQL_TO_APPLY"
if $park; then
  echo "PARK"
  exit 1
fi
echo "AUTO_MERGE_ELIGIBLE"
