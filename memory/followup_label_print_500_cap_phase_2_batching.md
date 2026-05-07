---
name: SuiteFleet label print 500-task cap → server-side batching for very large meal plans (Phase 2)
description: Day-17 PR #175 raised PRINT_LABELS_MAX_TASKS_PER_REQUEST from 100 to 500, empirically verified by SF probe (200, 2.2MB PDF, URL 4640 bytes well under 8KB origin limit, ~6.4s elapsed). 500-cap is MVP-final. Phase 2 server-side batching with PDF concatenation only triggers if a real merchant typically prints more than 500 labels per workflow.
type: project
---

# Label print 500-task cap — server-side batching (Phase 2)

**Surfaced:** Day 17, ~14:00 Dubai. Initially flagged at 300-cap when Love mentioned the SF API limit; subsequent Session B probe at 500 confirmed SF accepts up to 500 in a single CSV without rejection. PR #175 raises cap to 500 as MVP-final.

## §1 Empirical SF probe (PR #175)

`scripts/probe-sf-label-cap.mjs` against SF sandbox /generate-label with 500 SF external_ids:
- HTTP status: 200
- Content-Type: application/pdf
- Body: 2,217,994 bytes (~2.2 MB)
- Elapsed: 6,351 ms
- URL byte size: 4,640 (well under typical 8 KB origin limits)
- PDF magic header: %PDF ✓

500 IDs in single GET works cleanly. Probe script preserved in repo for reproducibility.

## §2 MVP posture (current, locked Day-17 via PR #175)

Operator selects N tasks. If N ≤ 500, single SF request, single PDF returned, streams to operator.

If N > 500, UI surfaces "Print first 500 of X selected" — submits first 500 in selection order (Set insertion order = visible-ids API order = created_at DESC newest first).

Acceptable for pilot because:
- 500-task batch covers >95% of practical operator workflows
- Most operators batch by route/zone/time-window in real ops
- Page-size dropdown maxes at 500; combined with select-all-across-pages, the workflow is bounded
- Demo posture: SF's effective constraint respected; clean operator UX

## §3 Phase 2 — server-side batching with PDF concatenation

Trigger conditions for revisiting this decision:
- A real merchant complains about chunking friction in a 500+ workflow
- Operations team reports operator workflow time loss measurably
- Pilot expansion onboards a merchant whose typical print batch exceeds 500
- SF's effective cap drops below 500 (e.g., they introduce stricter rate limits)

When triggered, ship Path 2:
- Service iterates batches of 500, fetches PDFs sequentially from SF (parallel risks rate-limit pressure), concatenates server-side using pdf-lib, streams merged PDF to operator
- Operator sees one click → one PDF download
- Per-batch error handling: one batch fails → retry that batch up to N times → if still fails, return partial PDF + X-Failed-Batches header? OR fail whole call with diagnostic?
- Test surface: real-Postgres integration tests for 500, 501 (boundary), 1000, 1500 (edge cases), batch-failure handling
- Operator UX: progress indicator if total > 500 (so operator knows the wait is expected)

Until any trigger fires, MVP posture stays.

## §4 Cross-references

- src/app/api/tasks/labels/route.ts (PRINT_LABELS_MAX_TASKS_PER_REQUEST = 500)
- src/modules/tasks/service.ts printLabelsForTasks (where batching would land)
- src/modules/integration/providers/suitefleet/label-client.ts (adapter; parallel-vs-sequential decision lives here too)
- scripts/probe-sf-label-cap.mjs (the empirical probe)
- memory/followup_planner_uuid_to_sf_external_id_translation.md (sibling SF-integration-discipline memo)
- PR #122 (original 100 cap), PR #172 (UUID translation), PR #175 (500 cap raise + this memo)
