#!/usr/bin/env bash
# Tests for docs-only-predicate.sh — the merge-gate / CI-fast-lane classifier.
# Pure-function tests: feed a change-set on stdin, assert the verdict + exit.
# Run:  bash scripts/orchestration/docs-only-predicate.test.sh
# This IS the acceptance matrix for PR #564's extension-guard + the adversarial
# vectors V1–V7. Any FAIL exits non-zero.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRED="$DIR/docs-only-predicate.sh"
pass=0; fail=0

# assert <name> <expect_exit> <expect_substr> [files...]
assert() {
  local name="$1" exp_exit="$2" exp_sub="$3"; shift 3
  local out rc ok=1
  out=$(printf '%s\n' "$@" | bash "$PRED"); rc=$?
  [ "$rc" = "$exp_exit" ] || ok=0
  case "$out" in *"$exp_sub"*) ;; *) ok=0 ;; esac
  if [ "$ok" = 1 ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    printf 'FAIL: %-52s exit=%s out=%q (want exit=%s contains=%q)\n' \
      "$name" "$rc" "$out" "$exp_exit" "$exp_sub"
  fi
}

# --- docs-only -> ELIGIBLE (fast lane) ---
assert "memory/*.md"                 0 AUTO_MERGE_ELIGIBLE  "memory/handoffs/x.md"
assert "root README.md"              0 AUTO_MERGE_ELIGIBLE  "README.md"
assert "docs nested .md"             0 AUTO_MERGE_ELIGIBLE  "docs/adrs/0007.md"
assert "tasks/todo.md"               0 AUTO_MERGE_ELIGIBLE  "tasks/todo.md"
assert "docs .docx (real file)"      0 AUTO_MERGE_ELIGIBLE  "docs/plan.docx"
assert "memory .csv snapshot"        0 AUTO_MERGE_ELIGIBLE  "memory/snapshots/test-tenants-archive-2026-05-08.csv"
assert "docs/brand .pdf"             0 AUTO_MERGE_ELIGIBLE  "docs/brand/Transcorp_Branding_Guidelines.pdf"
assert "docs/brand .png media"       0 AUTO_MERGE_ELIGIBLE  "docs/brand/logo.png"
assert "many docs files"             0 AUTO_MERGE_ELIGIBLE  "memory/a.md" "docs/b.md" "tasks/c.md"
assert "rename within docs"          0 AUTO_MERGE_ELIGIBLE  "docs/a.md" "docs/b.md"
assert "ext case-insensitive PNG"    0 AUTO_MERGE_ELIGIBLE  "docs/brand/LOGO.PNG"

# --- mixed / code -> PARK (FULL CI). The whole safety case. ---
assert "MIXED: one doc + one code"   1 PARK  "memory/x.md" "src/app/page.tsx"
assert "code only"                   1 PARK  "src/app/page.tsx"
assert ".md under code dir (V1)"     1 PARK  "src/components/Note.md"
assert "move src->src (old+new)"     1 PARK  "src/x.ts" "src/y.ts"
assert ".github workflow edit"       1 PARK  ".github/workflows/ci.yml"
assert "package.json (root non-md)"  1 PARK  "package.json"
assert "root LICENSE (no ext)"       1 PARK  "LICENSE"

# --- EXTENSION-GUARD (Love ruling #3): non-doc file UNDER a trusted tree PARKS ---
assert "memory/*.ts (relocated, V2)" 1 PARK  "memory/evil.ts"
assert "tasks/*.sh executable"       1 PARK  "tasks/run.sh"
assert "docs/*.json non-doc"         1 PARK  "docs/data.json"
assert "memory/*.yml non-doc"        1 PARK  "memory/config.yml"
assert "docs/*.js non-doc"           1 PARK  "docs/bundle.js"
assert "relocate src->memory (.ts)"  1 PARK  "src/x.ts" "memory/x.ts"

# --- location matching stays CASE-SENSITIVE (V7) ---
assert "Memory/ capital -> park"     1 PARK  "Memory/x.md"
assert "root README.MD -> park"      1 PARK  "README.MD"

# --- migrations: always PARK + SQL_TO_APPLY flag (unchanged) ---
assert "migration -> PARK"           1 PARK          "supabase/migrations/0036_x.sql"
assert "migration -> SQL_TO_APPLY"   1 SQL_TO_APPLY  "supabase/migrations/0036_x.sql"
assert "migration + docs still park" 1 PARK          "memory/x.md" "supabase/migrations/0036_x.sql"

# --- fail-closed: empty change-set -> PARK (V3/V5 error symptom) ---
assert "empty change-set -> PARK"    1 PARK

echo "-----------------------------------------"
echo "docs-only-predicate: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
