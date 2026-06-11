# Day-53 PM check-in — Love's UAT calls (2026-06-11)

**Filed:** Day-53 PM (11 Jun 2026), Session A. Repo record of the PM check-in rulings, banked before the build lanes fire.

## The ruling, verbatim

> "Day-53 PM check-in: Love clears #368 and #370 for merge; rules the server-side metadata strip UAT-blocking (build before UAT); rules POD broken-image UAT-blocking — scope the smallest Planner-only fix, falling back to same-day-delivery UAT scripting if the fix genuinely needs the vendor (Love decides at that point); defers resolved-rows visibility past the first UAT; accepts the five §5 lower-probability race items as controlled-UAT risk, to be triaged before production merchants onboard. Confirmed by Love, 2026-06-11."

## Dispositions

| # | Ruling | Lane | Disposition |
|---|---|---|---|
| 1 | Clears **#368** for merge | Session B | Session B merges + promotes + proves; Session A does not touch. |
| 2 | Clears **#370** for merge | Session A | **DONE** — merged `2da5b29` via the admin API route, clearance quoted on the PR. Path-gate Layer-1 fail-closed is now live on main. |
| 3 | **Server-side metadata strip = UAT-BLOCKING** | Session A | Build per `memory/followup_r8_server_side_metadata_strip.md`: R8 allow-list applied server-side so excluded fields never reach the browser; client filter stays as belt-and-braces. Cross-review, PARK. |
| 4 | **POD broken-image = UAT-BLOCKING, Planner-only scope** | Session A | Ground first (re-read `memory/followup_pod_broken_image_pre_existing.md` + stored webhook payloads on real rows), then: smallest Planner-only fix if achievable → plan, build, park. If every Planner-only path dead-ends at the vendor → STOP and park the finding with evidence; **Love rules the fallback** (same-day-delivery UAT scripting). No fix that needs Aqib gets built. |
| 5 | **Resolved-rows visibility: DEFERRED past the first UAT** | — | No build. Closes the §7 product call for now. |
| 6 | **Five §5 lower-probability race items: ACCEPTED as controlled-UAT risk** | — | No build now; **triage before production merchants onboard** (`memory/uat_mvp_scope_definition.md` §5 is the list of record). |

## Same check-in, Love-directed (not in the verbatim batch)

**SF production auth lane opens (T3):** Client Credentials per Aqib's delivered docs — `clientId` + `clientApiKey` + `clientSecretKey` headers, 30-day access / 180-day refresh token lifecycle with automatic renewal — wiring the gated-inert `loginApiKey()` (#341) into the `api_key` resolver branch (brief v1.15 dual-path model; sandbox OAuth untouched). Plan-PR first, then code-PR; **both park.** Two standing park-flags: (a) real production credential values are entered by Love/Aqib directly via `/admin/merchants/[id]/credentials` — never through this terminal; (b) the live production probe call fires only on Love's named go (`memory/project_apikey_probe_gate_open` posture unchanged).

## Cross-references

- `memory/uat_mvp_scope_definition.md` §5 + §7 — the lists these rulings burn down.
- `memory/followup_r8_server_side_metadata_strip.md` (#360) — ruling 3's spec.
- `memory/followup_pod_broken_image_pre_existing.md` — ruling 4's grounding doc.
- `memory/decision_d53_morning_clearances.md` — the morning half of Day-53's rulings.
