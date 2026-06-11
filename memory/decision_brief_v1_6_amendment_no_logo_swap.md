---
name: Brief v1.6 amendment — labels proxied as-is from SF; no logo swap (Phase 1 or Phase 2)
description: Day 17 ~1:30 PM Dubai locked decision. Labels are proxied AS-IS from SuiteFleet's /generate-label endpoint; no PDF post-processing, no logo overlay, no rendering modification. Closes the L4 logo-swap workstream entirely — NOT a Phase 2 deferral. Brief v1.5 §3.5 referenced "logo swap"; that decision is reversed.
type: project
---

# Brief v1.6 amendment — labels proxied as-is from SF; no logo swap

**Filed:** Day 17 (7 May 2026), ~1:30 PM Dubai.
**Tier:** T1 (memory + brief amendment only — no logic, no schema, no behavior change).
**Brief version bump:** v1.5 → v1.6.

---

## §1 Trigger

Day-17 ~1:30 PM Dubai. Love instructed "we do not need the logo swap in the SF returned labels" + "no, ever" when asked Phase 1 or Phase 2.

This came mid-day during the L4-plan pre-flight discovery sequence (which had already established that SF's `/generate-label` endpoint requires SF external_ids, surfaced + diagnosed via PR #170 + PR #172 hotfixes). With label print operationally unblocked end-to-end, Love's call pre-empted the originally-scoped L4 plan PR drafting.

## §2 Reconciliation

Brief v1.5 §3.5 (L4 — Label generation) referenced "Proxy SF's existing label endpoint with Transcorp logo swap." That decision is reversed. Labels are proxied AS-IS from SuiteFleet — no PDF post-processing, no logo overlay, no rendering modification.

The downstream effects:
- L4 plan PR is no longer needed; the existing `/api/tasks/labels` flow IS the MVP-final state for labels
- The SF logo placement question (which the live probe surfaced indirectly) is moot — we don't care about SF's logo placement because we won't be modifying their PDF
- No new PDF-manipulation library dependency; no Day-17/18 implementation work for L4

## §3 Demo framing

If the Q&A panel asks about the SF logo appearing on the printed shipment label, the demo answer:

> "SuiteFleet is our backend last-mile execution provider; the label format is theirs by design. Our value-add is the upstream operator workflow — subscription planning, skip-and-append, calendar view, CRM state. Label rendering is not in our IP scope."

This positions Transcorp's IP correctly per brief §1: Transcorp owns the operator UX + merchant-CRM functionality + data model; SuiteFleet is a vendor consumed for last-mile execution. The label-PDF format is firmly on SuiteFleet's side of that boundary.

## §4 Operational impact

Current `/api/tasks/labels` flow proxies SF PDF bytes directly to operator. The Day-17 hotfixes that made this operational:
- PR #170 — drizzle/postgres-js array-binding bug fix (`listVisibleTaskIds` + `tenant-admin-invariant`)
- PR #172 — Planner UUID → SF external_id translation in label print path; X-Skipped-Count partial-success surface; NoLabelablePushedTasksError 422 for all-pre-push input; adapter 5xx logging gap closed

No further label-related code work in scope. The label print path is MVP-final.

## §5 Phase 2 status

**Logo swap is NOT a Phase 2 deferral.** It is closed scope.

If post-pilot operator feedback or commercial requirement shifts this (e.g. if Transcorp later decides white-label-style label rebranding has commercial value), that's a future product decision — not on any current roadmap. The followup memo `memory/followup_planner_uuid_to_sf_external_id_translation.md` (created in PR #172) remains accurate as-is; it captures the translation pattern that survives independent of any future logo-rebranding discussion.

## §6 Cross-references

- `memory/PLANNER_PRODUCT_BRIEF.md` v1.5 §3.5 — the line being dropped
- PR #170 — drizzle array-binding hotfix that unblocked the label print path
- PR #172 — Planner UUID → SF external_id translation; established the MVP-final state
- `memory/decision_mvp_shared_suitefleet_credentials.md` — Path B sandbox 588 credential posture; preserved
- `memory/followup_suitefleet_label_endpoint.md` — load-bearing token-in-query security constraint; preserved
- `memory/followup_planner_uuid_to_sf_external_id_translation.md` — translation convention from PR #172; remains active
