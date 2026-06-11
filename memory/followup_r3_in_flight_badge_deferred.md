# R3 note-push in-flight badge (`pending_update` retrofit) — DEFERRED past UAT

**Filed:** Day-53 (11 Jun 2026), Session A, per Love's Day-53 morning clearances ("defers the R3 in-flight badge past UAT"). T1 record of a no-build ruling.

## What was asked

Session B's Day-52 EOD (`memory/handoffs/day-52-eod-session-b.md` §E.2) flagged: R3's note push (shipped Day-52, PR #344) predates the `pending_update` outbound-sync state (migration 0029 / R4-R5 stack) and does not set an in-flight state — so a note push in flight shows no badge, while R4/R5 address-override pushes do. The OQ-1 ruling text covered "R3/R4/R5 update-style pushes," making `addNoteToDriver` a retrofit candidate. Session B deliberately did NOT build it (avoiding gold-plating) and asked for a one-line ruling.

## The ruling

**Deferred past UAT.** No build now. Rationale dimension: UAT runs on the proven R3 leg as-is; the badge is cosmetic in-flight feedback, not correctness — the push itself settles `synced` and is webhook-confirmed (Day-52 proving pass, R3 PASS on real wire).

## When it revives

Post-UAT, as a small T2 follow-on: `addNoteToDriver` sets `outbound_sync_state='pending_update'` before enqueue, riding the same settle path R4/R5 use. Depends on migration 0029 being live (cleared Day-53 for production apply). Re-raise after the UAT-MVP blocking list (`memory/uat_mvp_scope_definition.md` §7) clears.

## Cross-references

- `memory/decision_d53_morning_clearances.md` — the ruling record.
- `memory/handoffs/day-52-eod-session-b.md` §E.2 — the originating flag.
