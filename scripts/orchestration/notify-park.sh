#!/usr/bin/env bash
# Shape-3 orchestration — park-batch email notification via Resend (Fork 2,
# Love-ruled Day-52: event-driven email alongside the desktop push).
#
# Usage:  notify-park.sh <subject>     (body on stdin = new PARKED-QUEUE.md entries)
#
# Key: ORCH_RESEND_API_KEY in .env.local — gitignored (".env*", .gitignore:32),
# never committed, never printed. Love-ruled recommendation: a SEPARATE
# orchestration key, independently revocable without touching production email
# (production's RESEND_API_KEY lives only in Vercel and is not reachable here).
set -euo pipefail

subject="${1:?usage: notify-park.sh <subject>  (body on stdin)}"
to="love.mansukhani@gmail.com"
# Pending Love's confirmation of the from-address (dev-scope EMAIL_FROM is the
# Resend sandbox sender; the production value was not read). One line to change.
from="onboarding@resend.dev"

root="$(git rev-parse --show-toplevel)"
# grep made non-fatal: under set -e a missing key/file would otherwise abort
# before the guard below can print its pointer.
key="$(grep -m1 '^ORCH_RESEND_API_KEY=' "$root/.env.local" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$key" ] || { echo "ORCH_RESEND_API_KEY missing from .env.local — see RUNBOOK step 6" >&2; exit 1; }

jq -n --arg from "$from" --arg to "$to" --arg subject "$subject" \
  --rawfile text /dev/stdin \
  '{from: $from, to: [$to], subject: $subject, text: $text}' \
  | curl -sS --fail-with-body -X POST "https://api.resend.com/emails" \
      -H "Authorization: Bearer $key" \
      -H "Content-Type: application/json" \
      -d @-
echo
