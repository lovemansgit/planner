---
name: HEM 403 single-tenant outbound credential failure (Day-31 surface, Day-33 durable filing)
description: HEM tenant outbound SF push returns 403; surfaced Day-31 during MPL credential outage triage as a separate adjacent surface (different tenant, different region binding). Tracked verbally + Aqib coordination thread only at the time of filing — this memo anchors it durably. Resolution scope unknown without Aqib's diagnostic; could be Vault placeholder (like MPL was) or SF OpsPortal-side credential misconfiguration. Triage required before scoping a fix. NOT load-bearing for any active lane.
type: followup
---

# Origin

Day-31 (2026-05-19) production-smoke triage on the MPL tenant outbound SF push failure surfaced a **second, distinct credential failure on the HEM tenant** in the same window. The MPL triage walked five candidate causes and confirmed root cause #5 (Vault placeholder instead of real credentials in SF OpsPortal — Love + Aqib coordinated, real credentials configured, MPL push restored end-to-end). See [`memory/handoffs/day-31-32-eod-consolidated.md`](handoffs/day-31-32-eod-consolidated.md) §B.3 for the MPL triage record.

The HEM failure was identified in the same session, classified as **a separate adjacent surface** with these observed characteristics:

- **Tenant:** HEM (NOT MPL — different tenant, different `tenants` row).
- **Region binding:** different from MPL's binding (per the §B.3 record).
- **Failure mode:** SF outbound push returns HTTP **403** on the operator-initiated cancel/update path.
- **Triage status at surface:** parked. The MPL triage closed end-to-end; HEM was filed as a follow-up needing Aqib coordination but did NOT receive its own five-candidate walk-through in the same session.

This memo exists to make that verbal/thread-only tracking durable in repo memory. Filed Day-33 (2026-05-21) per the housekeeping recommendation in [`memory/handoffs/day-31-32-eod-consolidated.md`](handoffs/day-31-32-eod-consolidated.md) §G + [`memory/MEMORY-followup-current.md`](MEMORY-followup-current.md) §T1-followon-1.

# Status at filing

- **Tracking surface so far:** verbal exchange in the Day-31 triage session + the Aqib coordination thread (Slack / email — surface-of-record TBC at next Aqib touch). NOT durably anchored in any repo memo until this filing.
- **Production behavior:** HEM tenant outbound pushes (cancel / update / skip → cancel) continue returning 403 from SF until Aqib coordination resolves. Operator-initiated actions on HEM consignees write the local-state side correctly (DB row update + audit event); the SF-side push is the failing leg.
- **Failed-pushes backlog:** the Day-31+32 MPL backlog cleanup (9 rows resolved Day-32 AM per consolidated EOD §C.2) intentionally **did NOT touch the HEM row(s)**. Those remain in `failed_pushes` un-resolved as the operational record of the gap, pending whatever resolution path Aqib's diagnostic surfaces.
- **Aqib coordination status:** thread exists, no diagnostic reply landed yet. The thread itself is the discoverable artifact; this memo is the in-repo anchor pointing at it.

# Scope of resolution (unknown without Aqib's diagnostic)

The HEM 403 root cause has not been narrowed. Two plausible shapes — both seen in adjacent surfaces — are:

1. **Vault placeholder (the MPL shape).** Production Vault stores the row, but the value is a placeholder string written during region bootstrap, not the real `loginApiKey` body. MPL hit exactly this; the fix was Love + Aqib obtaining the real value and writing it via the admin credentials surface. If HEM is the same shape, the fix is mechanically identical (operator action, no code change).
2. **SF OpsPortal-side credential misconfiguration.** The credential row in Vault is correct, but the corresponding SF-side configuration (client_id binding, region scope, granted permissions on the OpsPortal record) is wrong or absent — so SF returns 403 even with a valid request. If HEM is this shape, the fix lives on SF's side; Planner cannot patch around it.

Other possibilities the diagnostic must rule out (mirrors the MPL five-candidate walk):

- QStash flow-control rate limit (MPL refuted — empirical, but HEM's logs need their own check).
- SF API base URL drift (MPL refuted — same host, same path; same for HEM unless region binding routes elsewhere).
- Tenant-region binding broken (MPL refuted — region row + FK intact; HEM's region binding noted as "different from MPL's" in §B.3 but not characterised further).
- Some HEM-specific shape not in the MPL candidate set (e.g. expired OAuth token if HEM is on the OAuth path; api_key cache stale if HEM is on api_key path; per-tenant SF rate-limit triggered by older bulk action).

The five-candidate walk is owed to HEM; this memo does not perform it. The walk requires production-log access + Aqib's reply on what the SF OpsPortal shows for the HEM merchant binding.

# Standing

- **NOT load-bearing for any active lane.**
  - **Plan #317** (T3 outbound push pipeline structural defects, OPEN at `f0ef560`) is queue-infrastructure-only — F-1..F-6 + CLEANUP-1 cover race windows, DLQ normalization, attempt_count idempotency, RLS gaps, CI smoke check, bulk-resolve tooling. NONE of those surfaces depend on HEM 403 resolution, and HEM 403 resolution does not depend on any of them.
  - **Calendar-management full-resolution lane** ([`followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md), filed Day-32 as PR #320) explicitly carves HEM 403 out of scope in its Non-goals section. Calendar lane is operator-action surfaces (skip variants, move-to-date, etc.) — not credentials.
  - **Outbound-symmetry follow-on** (Planner→SF EDIT propagation, committed Day-31 PM fold of #306 §5) is also separate. EDIT propagation works the same auth path as cancel/update; HEM 403 will affect that lane the same way it affects current outbound paths, but the lane scope is the propagation logic, not the credential surface.
- **HEM tenant operator impact:** outbound pushes continue failing until resolved. Local-state side (DB + audit) is correct. Operators can still skip / cancel / update on HEM consignees and the Planner-side row will reflect truth; the SF side stays out-of-sync until HEM credentials work.
- **Demo posture:** the sandbox tenant (`transcorpsb`, OAuth path) is the demo surface and is unaffected. HEM is a production-region tenant; production-region failure modes are positioned per the v1.15 dual-path stance in [`followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) ("ready and waiting on vendor coordination").
- **No production hot-patch warranted.** The gap is operator-visible (push failures show up in `failed_pushes`) but not data-corrupting. The right unblock is the Aqib diagnostic, not a Planner-side workaround.

# Non-goals

This memo **does NOT**:

- Propose a fix. Resolution shape is unknown until Aqib's diagnostic lands.
- Schedule a code-PR. There is no scoped code-PR yet; whether one is needed at all depends on whether the root cause lives on Planner (Vault row) or SF (OpsPortal config).
- Re-open the MPL triage. MPL is resolved end-to-end and that lane is closed.
- Touch the Plan #317 lane. #317 is queue-infrastructure-only; this memo's existence does not change that lane's scope or sequencing.
- Touch the calendar-management lane. Calendar lane sequences after #317 and is operator-action-surface-only.

Its only job is to anchor the HEM 403 issue durably in repo memory so it isn't lost when the Day-31 triage session's verbal context decays.

# Trigger for next-action

When Aqib's diagnostic reply lands (Slack / email / SF OpsPortal data), the next action is:

1. **Classify which shape HEM 403 is** — Vault placeholder (MPL shape) or SF OpsPortal-side misconfiguration or something not in the MPL candidate set.
2. **If Vault placeholder:** operator action via the admin credentials surface (same path Love used for MPL). No code change. Verify end-to-end with a fresh HEM cancel push smoke. Resolve the `failed_pushes` HEM rows once verified.
3. **If SF OpsPortal-side:** the fix lives outside Planner. Track as an Aqib-side action; once SF confirms the fix on their side, re-run the smoke and resolve the `failed_pushes` HEM rows.
4. **If something else:** scope a small T2 PR after the diagnostic surfaces the exact shape.

In all cases the post-resolution housekeeping is: resolve the HEM rows in `failed_pushes`, append the resolution path to this memo, and decommission it from the active-followup digest if/when filed there.

# Cross-references

- [`memory/handoffs/day-31-32-eod-consolidated.md`](handoffs/day-31-32-eod-consolidated.md) §B.3 — MPL credential outage triage record; HEM 403 noted as adjacent surface.
- [`memory/handoffs/day-31-32-eod-consolidated.md`](handoffs/day-31-32-eod-consolidated.md) §E + §G — recommends durable T1 filing for HEM 403 in next session housekeeping (this memo is that filing).
- [`memory/MEMORY-followup-current.md`](MEMORY-followup-current.md) §T1-followon-1 — same recommendation, restated in the active-lane digest.
- [`memory/followup_aqib_api_key_auth_header_pending.md`](followup_aqib_api_key_auth_header_pending.md) — adjacent credentials surface (the v1.15 dual-path SF auth pending Aqib's endpoint + header confirmation). Different scope (auth-header shape for api_key path) but same Aqib coordination thread.
- [`memory/followup_calendar_management_full_resolution.md`](followup_calendar_management_full_resolution.md) Non-goals — explicitly carves HEM 403 out of the calendar lane.
- Plan #317 plan-PR: [`lovemansgit/planner#317`](https://github.com/lovemansgit/planner/pull/317) at `f0ef560` — out-of-scope cross-reference; HEM 403 is NOT in the #317 lane.

# Meta

Filed Day-33 (2026-05-21) as a T1 docs-only housekeeping PR off main HEAD `1621b14`. Single commit, single file. Filing is mechanical — the institutional record is the substance.
