# Session A bootstrap brief — Day-22 AM start

**For:** fresh Session A successor at Day-22 AM kickoff
**Filed:** Day 21 (10 May 2026), evening, post Day-21 close (#227 SF outbound + #228 preflight merged)
**Filed by:** outgoing Session A overnight
**Lane:** Phase 1 merchant-CRUD frontend forms — operator-facing UI surface that consumes Day-20 backend foundation (#222) + Day-21 SF outbound adapter (#227)

---

## §1 Handoff context

Day-21 closed with three substantive merges:

- **PR #227** — Phase 1 SF outbound adapter (T3) + DLQ scaffolding + CONCERN B PII strip + 4 QStash routes. Merged at `65aeff1`.
- **PR #228** — `demo-preflight.sh` 10-gate verification (T2). Merged at `3453a60`.
- **Q3 doc-memo amendment** — `decision_phase_1_aqib_doc_verified.md` Q3 row corrected per Day-21 LANE 1 probe (bulk endpoint takes numeric SF task ids, not AWBs).

**Day-22 AM Session A scope: Phase 1 merchant-CRUD frontend forms — the operator-facing UI lane.** Per plan §I.2 row Day 22 the aggregate is ~12 hr (forms + cadence preset chips + address picker + subscription preview + bulk action bar). Lane chunks below in §5.

**This is bootstrap only. Do NOT begin substantive code work in the bootstrap session.** Day-22 AM Session A wakes up fresh, reads this brief + the references in §10, then opens code work in a fresh context window.

---

## §2 Branch state at handoff

- **`origin/main` HEAD:** `3453a60` (post #228 demo-preflight merge)
- **Production HEAD:** unpromoted Day-20/21 batch held by Love; Day-22 morning batched Vercel promote sweeps:
  - #220 / #221 / #222 / #223 / #224 / #225 / #226 (Day-20 + Day-21 morning)
  - #227 SF outbound adapter
  - #228 demo-preflight
  - Session B's PR-A2 calendar continuation when it lands (or close + carry to Day-23)
  - Session B's `day21/header-alignment-brand-pass` if that lands too
- **Migration 0023** — `0023_outbound_push_failures.sql` application atomic with the promote per CONCERN B PII-strip-at-write contract.
- **Vercel CLI scope quirk** persists per Day-20 EOD §2.1 — use `--scope=lovemansgits-projects` flag.
- **Pre-staged Day-22 branch:** `day22/phase-1-service-layer-publisher` from main HEAD `3453a60` carries overnight LANE 2 work — service-layer publisher fns that consume #227 adapter via QStash. Session A merges that first if pre-flight reviews clean.

---

## §3 §J rulings locked (CRITICAL — do NOT relitigate)

Per [`memory/handoffs/day-19-eod.md`](day-19-eod.md) lines 125-131, the Phase 1 plan-PR §J open questions all ruled at plan-PR §3.6 close:

### §3.1 §J-1 — Form UX patterns ✓
- **Modal for edit affordances** (PR #174/#177/#206/#213 precedents)
- **Full-page for new** (`/consignees/new`, `/subscriptions/new`, `/tasks/new` — multi-section forms warrant page-level real estate)

### §3.2 §J-2 — Bulk action UX ✓
- Selection persistence: **reuse PR #175/#176 mechanism** (already shipped on `/tasks/client.tsx`)
- **Inline confirmation panel** (matches §D pause confirmation pattern); no toast-only failure states
- **NO undo affordance for v1** (reverse SF cancel non-trivial; revisit Phase 2 if operators ask)

### §3.3 §J-3 — Subscription preview component ✓
- **Inline within form**, below cadence section, above submit
- **Hero-numeral pattern**: "**127** tasks across **31 days** (1 May – 31 May)"
- Atmosphere primitive: `--color-tint-navy-subtle`

### §3.4 §J-4 — Single-task toggle UX ✓
- **Lock URL at `/subscriptions/new`** even when single-task selected (no separate `/tasks/new` route)
- **H1 shifts to "New ad-hoc task"** when single-task radio is selected
- Cadence section hides when "Single task" selected; date or date-range picker shows
- Per §B.1 #7 + Love's Day-19 PM product-vision dump: single-task vs subscription is a checkbox/radio at top of subscription create form

### §3.5 §J-5 — Permission catalogue assignments ✓ SPLIT PERMS
- `task:create` / `task:bulk_update` / `task:bulk_cancel` → **`ops-manager` ONLY**
- `task:cancel` → **`ops-manager` AND `cs-agent`**
- Already shipped in PR #222 backend foundation — frontend just needs to gate UI per these perms

### §3.6 §J-6 — outbound_push_failures DLQ visibility ✓
- **DB writes only v1**; UI is Phase 2
- Already filed as `followup_dlq_viewer_phase_2.md`
- Day-22 frontend forms have NO read surface against `outbound_push_failures` — it's invisible to operators in v1

---

## §4 Plan-locked architectural concerns (CRITICAL — verify in code-PR §3.6)

### §4.1 CONCERN — Service-layer publisher is the bridge between forms and #227 adapter

The Day-22 UI forms consume **service-layer fns** (`cancelTask(ctx, taskId)`, `updateTask(ctx, taskId, patch)`, `bulkCancelTasks(ctx, taskIds)`, `bulkUpdateTasks(ctx, taskIds, patch)`) which:

1. Validate permission per §J-5 split perms
2. Validate cutoff per [`isCutOffElapsedForDate`](../../src/modules/subscriptions/service.ts) (existing helper)
3. Open a tx, mark local DB state, emit audit
4. Enqueue QStash message via the publisher landing tonight on `day22/phase-1-service-layer-publisher`
5. QStash routes shipped at #227 (`/api/queue/cancel-task`, `/api/queue/update-task`) consume + push to SF
6. SF webhook drives state convergence (no direct UI feedback loop on SF state)

**Operator UX implication:** form submits return optimistically once local DB writes commit. Subsequent SF state diverges asymptotically via the inbound webhook receiver. The `pushed_to_external_at` indicator on `/consignees/[id]` calendar surfaces SF acknowledgement honestly per brief §3.3.6.

### §4.2 CONCERN — `/consignees/[id]/edit` overlap with PR-A2 calendar lane

Session B's PR-A2 lane covers `/consignees/[id]` calendar surface (calendar views + popover actions). Day-22 frontend forms add `/consignees/[id]/edit` — a **separate route** but the consignee-detail page header / nav surface overlaps. Watch-items:

- If PR-A2 ships an "Edit" affordance on consignee detail header, the new `/consignees/[id]/edit` route plugs into that affordance. Coordinate with Session B's surface (don't duplicate the affordance).
- Do NOT touch [`src/app/(app)/consignees/[id]/page.tsx`](../../src/app/(app)/consignees/[id]/page.tsx) header chrome unless Session B's PR-A2 has merged and the surface is stable.

### §4.3 CONCERN — `frontend-design` skill activation

Plan §7 quality gate: "Frontend-design skill activation. Every UI implementation PR explicitly invokes `frontend-design` skill at session start." Day-22 forms are pure UI — invoke skill at lane open.

---

## §5 Day-22 AM lane plan (5 sub-lanes, ~12 hr aggregate)

### §5.1 LANE 1 — Service-layer publisher merge (~30 min if review-clean)
Pre-staged on `day22/phase-1-service-layer-publisher` from `3453a60`. Implements:

- `cancelTask(ctx, taskId)` — service-layer fn that validates perms + cutoff, marks local task CANCELED, audits, enqueues QStash to `/api/queue/cancel-task`
- `updateTask(ctx, taskId, patch)` — same pattern; consumes #227 adapter via QStash route
- `bulkCancelTasks(ctx, taskIds)` — transactional DB UPDATE + bulk QStash enqueue (single bulk message with numeric SF ids, NOT parallel fan-out)
- `bulkUpdateTasks(ctx, taskIds, patch)` — same transactional pattern

Session A AM reviews this branch first. If clean: open T2 PR + merge before starting LANE 2-5. If reviewer §3.6 surfaces gaps: merge gates LANE 2-5 work.

### §5.2 LANE 2 — Consignee forms (~3 hr)
- `/consignees/new` — full-page (§J-1) 4-step wizard per brief §3.3.1: identity → addresses → subscription → schedule rules. Single-tx submit creates consignee + addresses + subscription + rotations.
- `/consignees/[id]/edit` — full-page edit form (§J-1). Coordinate with PR-A2 surface per §4.2.

### §5.3 LANE 3 — Subscription form + preview component (~4 hr)
- `/subscriptions/new` — full-page (§J-1) with single-task radio toggle (§J-4 URL stays, H1 shifts)
- Cadence preset chips per plan §C (Mon-Fri / Mon-Wed-Fri / Weekend / Daily / Custom) — preset prefills 7 weekday checkboxes; operator can edit checkboxes regardless of preset
- Subscription preview component inline below cadence (§J-3 hero-numeral + `--color-tint-navy-subtle`)
- `/subscriptions/[id]/edit` — full-page edit (pause/resume action lives here per brief §3.3.5)

### §5.4 LANE 4 — Task edit modal (~2 hr)
- `/tasks/[id]/edit` triggers a modal (§J-1) — single-purpose modal: edit task fields only; no nested affordances
- Editable fields per plan §E.1: `delivery_date`, `delivery_start_time`, `delivery_end_time`, `address_id`
- Cutoff guard: refuse edit if `isCutOffElapsedForDate(task.deliveryDate)`; surface inline ValidationError
- Address picker: dropdown of `consignee.addresses`; "+ Add address" link to `/consignees/[id]/edit#addresses`

### §5.5 LANE 5 — Bulk action bar wire-up (~2 hr)
- Bulk action bar appears on `/tasks` list page when ≥1 row selected (selection state already shipped per §J-2 / PR #175/#176)
- Bulk-edit modal: field-pick UI (date / time-window / address); same value applied to all selected; per-task cutoff check; partial-failure inline confirmation panel
- Bulk-cancel modal: confirmation "Cancel N tasks? This pushes cancel to SuiteFleet."; same partial-failure UX
- Wire to LANE 1 service-layer fns (`bulkUpdateTasks` / `bulkCancelTasks`)

---

## §6 Frontend-design skill posture (Day-22 specific)

Day-22 lane is pure UI; the `frontend-design` skill applies. Discipline at session start:

1. Invoke `frontend-design` skill explicitly via Skill tool at lane kickoff
2. Reference [`subplanner.vercel.app/consignee/c_001`](https://subplanner.vercel.app/consignee/c_001) prototype + [`transcorp-lofi-v2.vercel.app`](https://transcorp-lofi-v2.vercel.app) brand language
3. Brand tokens at [`src/styles/brand-tokens.css`](../../src/styles/brand-tokens.css) are the implementation source of truth (per brief §3.3.11)
4. Hairline borders 0.5px Stone 200 (`#D3CEC2`); never shadows. Sentence case throughout (per Day-17 polish convention)
5. New UI elements use atmosphere primitives (`--color-tint-navy-subtle` for confirmation panels per §J-3); avoid one-off custom backgrounds

---

## §7 T1 ride-alongs (fold opportunistically)

- **Day-21 EOD doc** — file `memory/handoffs/day-21-eod.md` if not already filed (Love may file it tonight or Day-22 AM). Coordinate.
- **Day-22 morning batched Vercel promote** — owned by Love (UI/CLI lane); not a Session A action.
- **Migration 0023 application to Production DB** — owned by Love + atomic with the promote.
- **Followup memos** — verify all open `memory/followup_*.md` referenced in PR-A2 / #227 / #228 lane are still tracked (no audit needed; opportunistic check).

---

## §8 What NOT to do (Session A integrity)

- ❌ Do NOT relitigate §J-1 through §J-6 rulings — locked at Day-19 plan-PR §3.6 close
- ❌ Do NOT skip the `frontend-design` skill activation at lane open
- ❌ Do NOT touch [`src/app/(app)/consignees/[id]/page.tsx`](../../src/app/(app)/consignees/[id]/page.tsx) header chrome unless PR-A2 has merged
- ❌ Do NOT bypass the service-layer publisher and call adapter methods directly from form actions — service-layer is the audit + perm + cutoff gate
- ❌ Do NOT add `/admin/dlq/outbound-push-failures` UI in Day-22 scope — §J-6 deferred to Phase 2
- ❌ Do NOT touch Session B's branches or worktrees (`day21/phase-1-3-3-3-calendar-pr-a2`, `day21/header-alignment-brand-pass`)
- ❌ Do NOT begin substantive code work in this bootstrap session — fresh context window for code-PR open

---

## §9 Context-window expectation

Aggregate ~12 hr lane scope. **Realistic chunking:**

- LANE 1 service-layer publisher merge (~30 min)
- LANE 2 + LANE 3 forms first sub-PR (~7-8 hr); §3.6 hard-stop at sub-PR open with `frontend-design` skill output anchored
- LANE 4 + LANE 5 modal + bulk action bar second sub-PR (~4-5 hr); §3.6 hard-stop at sub-PR open

If session burns above ~50% memory mid-LANE-3, file mid-lane bootstrap brief before LANE 4 (precedent: Day-19 PM bootstrap brief #212 + Day-21 AM brief #226).

Reviewer expects T3 hard-stop at each sub-PR open. §3.6 body-read with §3.21 helper-consumer discipline + §3.22 UX walkthrough discipline applied to:

- New form pages (`/consignees/new`, `/consignees/[id]/edit`, `/subscriptions/new`, `/subscriptions/[id]/edit`) — UX walkthrough on Vercel preview
- Modal triggers (`/tasks/[id]/edit`) — modal precedent body-read against PR #174/#177/#206/#213
- Cadence preset chips — pattern verification against `/tasks/client.tsx` filter-pill precedent
- Subscription preview component — hero-numeral pattern + atmosphere primitive verification
- Bulk action bar — selection-persistence reuse verification against PR #175/#176

---

## §10 Files to read on Session A spawn (post-bootstrap)

**In order:**

1. [`memory/PLANNER_PRODUCT_BRIEF.md`](../PLANNER_PRODUCT_BRIEF.md) §3.3.1 (consignee onboarding wizard) + §3.3.5 (subscription detail page) + §3.3.11 (brand pass) + §10 (acknowledge protocol)
2. [`memory/plans/day-19-phase-1-merchant-crud.md`](../plans/day-19-phase-1-merchant-crud.md) §B.1 (MUST scope verbatim) + §C (cadence preset chips) + §D (pause flow + amended posture) + §E (edit-task scope) + §F (bulk operations) + §M.2 (architectural watch-items)
3. [`memory/handoffs/day-19-eod.md`](day-19-eod.md) §J rulings (lines 125-131) — 6 rulings absorbed verbatim
4. [`memory/handoffs/day-21-eod.md`](day-21-eod.md) — when filed by Love (Day-21 close); references PR #227 + #228 + Q3 amendment
5. **PR #227 + PR #228 merged commit messages** — context on what backend just shipped that the forms consume
6. **`day22/phase-1-service-layer-publisher` branch** — pre-staged service-layer publisher; review + merge as LANE 1 before forms work begins

After absorbing, surface readiness with:
- Verified `origin/main` HEAD post Day-22 morning promote
- Verified migration 0023 applied to Production DB
- Verified service-layer publisher branch reviewed + merge plan
- `frontend-design` skill invoked
- Stand by for §3.6 trigger at first sub-PR open

---

## §11 Open questions for Love's morning review

These surface from overnight Session A work and want a ruling before Session A commits them irrevocably:

1. **Service-layer publisher merge ordering** — should LANE 1 land as a separate T2 PR, or fold into the first frontend forms PR? Recommendation: separate T2 PR for clean review surface and rollback boundary; reviewer §3.6 ruling.

2. **Cadence preset chip exact wording** — "Mon-Fri" / "Mon-Wed-Fri" / "Weekend" / "Daily" / "Custom" per plan §C. Confirm exact strings (sentence case "Mon-Fri" vs all-caps "MON-FRI" vs spelled-out "Monday to Friday")?

3. **Single-task date-range mode** — when single-task radio + date-range picker, does each date in range generate a separate task row, or one task per date? Plan §B.1 #7 says "single date or date-range option per Love's vision" but generation semantics unspecified. Recommendation: one task per eligible date in range (mirrors subscription generation but with explicit op-or-bust scope).

4. **Address picker on task edit modal** — when consignee has only 1 address (no rotation, no alternative), should the address picker still show (single-option dropdown) or hide entirely? Recommendation: show with single option visible to keep the operator's mental model consistent across tasks-with-rotation vs tasks-without.

5. **Bulk-edit modal field-pick UI** — checkboxes per editable field, then a value editor per checked field? Or radio (one field at a time per bulk operation)? Plan §F.2 says "Field-pick UI: which fields to edit (date / time-window / address)" but interaction model unspecified. Recommendation: checkboxes (operator can bulk-edit date + time-window in one operation, e.g., "shift all selected from Mon to Tue with new 09:00-11:00 window"), with each checked field showing its editor inline.

6. **`pushed_to_external_at` indicator on form-submit feedback** — on `/tasks/[id]/edit` modal submit, does the form show the optimistic ack ("Saved — pushing to SuiteFleet") or wait for the webhook ack? Recommendation: optimistic ack with the integration-honesty indicator (`pushed_to_external_at`) refreshing on the calendar / list view via the existing webhook → DB → revalidate path; modal closes immediately on local DB success.

If Love rules these as part of morning review, Session A absorbs and proceeds. If a ruling is deferred ("operator-test it and feed back"), Session A picks the recommendation and surfaces in the code-PR §3.6 thread for ratification at PR open.

---

**End of bootstrap brief. Total read time projected ≈ 10-12 minutes for cold session. Carry-forward integrity preserved into Day-22 AM.**
