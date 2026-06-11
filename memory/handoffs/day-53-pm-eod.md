# Day 53 PM — End-of-day handoff (2026-06-11)

Canonical Day-53 PM record (extends the AM record at `day-53-eod.md`). The afternoon in one line: Love's PM rulings cleared #368+#370 (both merged; **calendar-management Phase 1 R1–R5 CLOSED**, path-gate fail-closed live), Session B proved the task-UPDATE push on real wire (#379), and Session A built + parked all four PM lanes — both UAT-blocking fixes (metadata strip #376, POD proxy #377) and the SF production-auth pair (plan #378 + code #380).

---

## §A — Final state at sign-off

- **Main HEAD:** `b54c7ee` (this EOD PR extends it by one docs commit). PM merge train: `2da5b29` #370 (path-gate fail-closed, Session A admin route) → `167f940` #368 (R5 full-horizon, Session B) → `75e61f0` #374 (PM rulings bank) → `b54c7ee` #379 (Session B proving pass).
- **Parked queue at sign-off (4):** #376, #377 (UAT-blocking pair, `parked-t2`) + #378, #380 (SF auth lane plan+code, `parked-t3`). All four opus APPROVE round 1. **Zero SQL to apply.** (#347 remains the old unlabeled design-surface park — pre-existing.)
- **Rulings of record:** `memory/decision_d53_pm_uat_calls.md` (verbatim + dispositions, merged #374).
- **Production:** Session B promoted during the day (their #373/#379 records); no Session A promote.

## §B — PM rulings → dispositions

1. **#368 + #370 cleared** → both merged. R1–R5 closed; Layer-1 gate now fails closed.
2. **Metadata strip (UAT-blocking)** → built TDD, **parked #376**: R8 allow-list applied server-side in `getTaskHistory` via shared `history-metadata.ts`; drawer re-filters same set as belt-and-braces. Hidden fields (`last_error`, correlation/idempotency plumbing, internal UUIDs) no longer reach the browser payload.
3. **POD broken-image (UAT-blocking)** → grounded on real rows FIRST: SF URLs are 7-day S3 pre-signed, minted ~1s before the DELIVERED webhook; expired rows are vendor-dead (probed: S3 403 "Request has expired"); the Day-33 within-TTL failure was browser policy — server fetch immune. **A Planner-only fix WAS achievable** → render-time authenticated proxy, **parked #377**. The same-day-delivery UAT-scripting fallback is moot. Deferred follow-ons recorded in the memo: durable ingest-time capture (migration + storage/cost call), admin POD cell, orphaned CalendarPodCard cleanup.
4. **Resolved-rows visibility** → deferred past first UAT (no build).
5. **§5 race items** → accepted as controlled-UAT risk; triage before production merchants onboard.
6. **SF production auth lane (T3)** → grounded finding: the directive's named wiring (resolver api_key branch → `login()` → `loginApiKey()` #341 → token-cache lifecycle) was **already merged end-to-end**; the genuine gap was api_key renewal riding the OAuth refresh wire that Aqib's docs never verified (Q4 residual). **Plan parked #378**; **code parked #380** (skip-refresh → full `loginApiKey` renewal ~monthly on 30-day tokens; probe gains a refresh-wire observation step that closes Q4 with evidence when run). **Standing park-flags:** credentials enter via `/admin/merchants/[id]/credentials` by Love/Aqib only — never through this terminal; the live production probe fires only on Love's named go.

## §C — Process notes

- **Builder error, corrected + disclosed:** the POD commit briefly rode #376's branch post-APPROVE; force-restore was declined by the permission layer (force-push pre-auth rule), so a revert restored the tree **byte-identical** to the approved SHA (verified empty diff) and the POD work shipped as the clean cherry-pick #377. Both PRs carry the note.
- Session B's known flaky pagination pair surfaced once in a full local integration run (passes in isolation with and without the diff) — their followup stands; nobody's scope today.
- Docs lane (Action automerge) ran clean all day: #374, #379, this EOD.

## §D — Morning review for Love (order matters only for the auth pair)

1. **Clear #376 + #377** — the two UAT-blocking rulings; with them merged, the §7 UAT-blocking list is **empty** (metadata strip ✓, POD ✓, resolved-rows deferred ✓, races accepted ✓) and the proving tail is done (task-UPDATE proven by Session B; POD post-fix render will be provable on the next live delivery via #377).
2. **Clear #378 then #380** (or together — #380's comments cite the plan doc that lives in #378).
3. Standing asks from the AM unchanged: paste the notify-park allow-rule (decision memo has the JSON), re-enable Remote Control.
4. When ready for the production-auth thread: provision api_key credentials via the admin UI (you/Aqib) and authorize the probe run by sentence — the probe now also records the refresh-wire observation (Q4).
