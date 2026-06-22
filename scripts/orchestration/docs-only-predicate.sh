#!/usr/bin/env bash
# Shape-3 orchestration — the PURE docs-only predicate.
#
# Reads a change-set as filenames (one per line) on STDIN and classifies it.
# NO network, NO gh, NO PR number — pure function of its input, so it is unit-
# testable (see docs-only-predicate.test.sh) and shared by both consumers:
#   - path-gate.sh        (the server-side merge gate, fed by `gh api .../files`)
#   - .github/workflows/ci.yml `detect` job (the CI fast-lane)
# One predicate, one source of truth — the merge gate and CI can never drift on
# what "docs-only" means.
#
# Classification (a file is docs-only ONLY if BOTH hold):
#   1. LOCATION is trusted:
#        memory/**, docs/**, tasks/**  -> trusted tree
#        root-level (slash-free) *.md  -> trusted (unchanged from the original gate)
#      Anything else (any other nested path, any other root file) -> PARK.
#   2. EXTENSION is documentation-class (the extension-guard, trusted trees).
#
# supabase/migrations/** -> ALWAYS park, plus the SQL_TO_APPLY flag (unchanged).
#
# THE EXTENSION-GUARD (Love ruling, 22 Jun 2026, on PR #564 / this lane):
#   The allowlist used to trust by PATH alone — any file under memory/docs/tasks
#   rode the docs lane regardless of type. A future non-doc file under those
#   trees (e.g. a relocated `memory/thing.ts`, a `tasks/run.sh`) would then
#   fast-lane past CI and the merge gate. So a file under a trusted tree that is
#   NOT documentation-class now PARKS. The guard is a WHITELIST of inert,
#   non-executable, never-in-the-build-graph extensions — an unknown or new
#   extension parks, so extension drift fails closed. "Robustness beats
#   today's-tree-is-clean." This is the merge gate.
#
# This change is a PURE TIGHTENING of the prior gate: the only paths whose
# verdict changes are non-docs-class files under the trusted trees, which used
# to be eligible and now PARK. Every previously-parking case still parks; the
# root rule (`*.md` only) is unchanged; location matching stays case-sensitive.
#
# Stdout: optional "SQL_TO_APPLY" line, then "AUTO_MERGE_ELIGIBLE" or "PARK".
# Exit:   0 = docs-only (auto-merge eligible), 1 = park.
set -euo pipefail

# Documentation-class extensions. WHITELIST, not blocklist: anything not listed
# parks. All entries are inert content — never compiled, linted-as-code,
# bundled, or imported by the running app. Grounded in what actually lives under
# the trusted trees today (md/docx/csv/pdf) plus the obvious doc/brand media.
# Extension match is case-insensitive (scoped here so the case-sensitive
# location matching in the main loop is untouched).
is_docs_class() {
  local rc=1
  shopt -s nocasematch
  case "$1" in
    *.md|*.mdx|*.markdown|*.txt|*.rst) rc=0 ;;                  # text docs
    *.docx|*.pdf|*.csv) rc=0 ;;                                 # exported docs + inert data snapshots
    *.png|*.jpg|*.jpeg|*.gif|*.svg|*.webp|*.ico|*.avif) rc=0 ;; # doc/brand media
  esac
  shopt -u nocasematch
  return $rc
}

park=false
sql=false
saw_file=false

while IFS= read -r f; do
  [ -z "$f" ] && continue
  saw_file=true
  case "$f" in
    supabase/migrations/*) sql=true; park=true ;;
    memory/*|docs/*|tasks/*) is_docs_class "$f" || park=true ;;  # trusted tree + extension-guard
    */*) park=true ;;                                            # any other nested path
    *.md) ;;                                                     # root-level *.md (unchanged)
    *) park=true ;;                                              # any other root file (unchanged)
  esac
done

# Fail-closed: an empty change-set is only ever an error symptom upstream (no
# legitimate PR changes zero files). Never decide a merge on emptiness.
$saw_file || { echo "PARK"; exit 1; }

$sql && echo "SQL_TO_APPLY"
if $park; then
  echo "PARK"
  exit 1
fi
echo "AUTO_MERGE_ELIGIBLE"
