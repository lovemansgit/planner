# Day-56 / Phase 8 — SF status: render distinctly (T3 plan)

**Type:** T3 plan-PR (plan + decision memo + brief amendment). **No code, no migration file, no render change in this PR.** Reviewer body-reads at the pinned head; the build is scoped into lanes only AFTER Love clears the plan.

**Brief base:** v1.30 (re-fetched fresh from `main`; the earlier session read a stale v1.29 WebFetch cache — corrected). §10 acknowledge protocol absorbed. **SQL TO APPLY: no (plan only).**

**Love's enumeration rulings — BAKED IN, not re-litigated:**
1. **Color groups by FAMILY** (amber ramp for the in-transit journey; red for the failure family; etc.). Where two states share a family colour, the **icon + label** make them distinct. **No new hex, no palette widening.** Every state must be glance-distinguishable by the **combination** of colour + icon + label — that satisfies the A2 "render distinctly, no collapsing" mandate.
2. **OUT_FOR_DELIVERY gets the brightest amber** (Signal Amber `#E8A33C`) — it is the highest-attention state. Mid-journey in-transit states demote down the amber ramp.
3. **The calendar mislabel is FIXED:** in-transit and out-for-delivery are TWO different statuses and render as two different statuses. `DayDisplayStatus` stops folding/mislabeling them.

---

## §0. Why this exists — two collapse layers

A2 ("every SF status renders distinctly on Planner — no collapsing"; Love-ruled scope expansion) cannot be satisfied at the render layer alone, because the distinction is **destroyed upstream in two places**:

- **Layer 1 — the SF→internal mapper.** 14 distinct courier lifecycle states collapse to **7** coarse internal statuses today:
  - `IN_TRANSIT` ← PICKED_UP · ARRIVED_AT_DC · IN_TRANSIT · HUB_TRANSFER · OUT_FOR_DELIVERY (5→1) **[headline loss]**
  - `FAILED` ← FAILED · PROCESS_FOR_RETURN · RETURNED_TO_SHIPPER (3→1)
  - `ON_HOLD` ← RESCHEDULED · REATTEMPT (2→1)
  - CREATED ← ORDERED · ASSIGNED ← ASSIGNED · DELIVERED ← DELIVERED · CANCELED ← CANCELED (1→1 each)
  - (`status-mapper.ts` action map + `status-progression.ts` status-field-value map both encode this collapse.)
- **Layer 2 — the calendar projection.** `DayDisplayStatus.projectDayDisplayStatus` collapses the 7 coarse statuses *again* to ~6 display statuses, and **mislabels**: `IN_TRANSIT → "Out for delivery"` (wrong — in-transit ≠ out-for-delivery) and `ASSIGNED | CREATED | ON_HOLD → "Scheduled"` (loses three distinct states).

**Rendering distinctly therefore requires the internal model to CARRY the distinction.** This plan adds that carrier and rewires the render layer to read it, while leaving the coarse lifecycle (which all of the v1.17–v1.30 business logic depends on) untouched.

---

## §1. The model decision (central architecture choice → OQ-1)

Two ways to carry the fine distinction:

**Option A — expand `internal_status` itself to ~14 values.** Literal reading of "new internal status set." **Rejected as the recommendation:** massive blast radius. `internal_status` is the spine that `editability.ts`, `status-progression.ts` (`LINEAR_RANK`, `HARD_TERMINAL`, `shouldAdvanceStatus`), the pause/resume fan-out (v1.17/v1.23), the churn cascade (v1.26), move-to-date (v1.30), the `/tasks` filter, and several repository `internal_status IN (...)` queries (e.g. `0016` line 254) all reason about. Exploding it to 14 risks regressing freshly-shipped lifecycle machinery, and the in-transit ramp would force a 5-rung linear spine into `shouldAdvanceStatus`. Historical `IN_TRANSIT`/`FAILED`/`ON_HOLD` rows cannot be disambiguated → forward-only backfill is ambiguous.

**Option B (RECOMMENDED) — coarse + fine.** Keep `internal_status` at its current 8 values (`CREATED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, CANCELED, ON_HOLD, SKIPPED`; unchanged CHECK). Add a **new nullable `tasks.courier_status`** column carrying the fine SF courier state for **rendering only**. Business logic keeps reading coarse `internal_status`; render surfaces read `courier_status` and **fall back to the coarse map when it is NULL** (Planner-only states — SKIPPED, manual cancel — and pre-backfill rows). This isolates the entire change to (a) the webhook applier, which writes both fields, and (b) the render layer. **Lowest risk, cleanest backfill, honest about Planner-only states.**

> **OQ-1 — recommend Option B.** The rest of this plan is written against B; §8 names the migration for both variants so Love can rule either way.

---

## §2. The `courier_status` enum (name them; ARRIVED fold → OQ-2)

14 distinct courier lifecycle states. The 15th SF action `TASK_HAS_BEEN_UPDATED` is a **non-lifecycle edit** (address/note/weight) → not a status, renders nothing (maps to `null` today — unchanged). `ARRIVED_ON_DC` (action suffix) and `ARRIVED_IN_DC` (status-field value) are **one state spelled two ways** → folded to a single `ARRIVED_AT_DC` (OQ-2: recommend yes — Love's enumeration already noted this).

```
ORDERED · ASSIGNED · PICKED_UP · ARRIVED_AT_DC · IN_TRANSIT · HUB_TRANSFER
· OUT_FOR_DELIVERY · DELIVERED · FAILED · PROCESS_FOR_RETURN
· RETURNED_TO_SHIPPER · CANCELED · RESCHEDULED · REATTEMPT
```

Count reconciliation (honesty note for the record): the **15-action** vocabulary (brief §3.1.10) minus the 1 non-lifecycle edit = **14 lifecycle actions = 14 distinct courier states** with ARRIVED counted once. The prior enumeration's parenthetical "13 if you fold ARRIVED" was off-by-one — ARRIVED is already a single action in either vocabulary, so the fold does not reduce the 14. **The real number is 14.** The "8" in memory = the 8 status-field VALUES empirically observed on the wire (`status-progression.ts` header). These 14 map to the unchanged coarse 8 exactly as the existing mapper tables already encode.

---

## §3. Per-state LABEL + ICON + family-COLOUR (the deliverable Love reacts to)

Colours are **family-grouped** (Love's ruling); the **icon + label** disambiguate within a family. All hex from §3.3.11 — **no new hex.** Icons: `tasks/_components/*Icon.tsx` (existing: `PackageIcon`, `VanIcon`, `TruckIcon`, `PodIcon`, `CautionIcon`). New icons named below.

| # | courier_status | coarse internal | proposed label | icon | family colour (§3.3.11) | obs/inf | notes |
|---|---|---|---|---|---|---|---|
| 1 | `ORDERED` | CREATED | Ordered | `PackageIcon` (existing) | **Neutral** — Stone 200 `#D3CEC2` fill / Stone 600 `#4E4A42` text | observed | pre-movement; matches current "Created" neutral pill |
| 2 | `ASSIGNED` | ASSIGNED | Driver assigned | `VanIcon` (existing) | **Info** — Ocean Blue `#1F6FA8` | observed (action) | ⚠ **changes** current amber ASSIGNED pill → Ocean Blue, freeing amber for the transit ramp and giving "assigned" its own family |
| 3 | `PICKED_UP` | IN_TRANSIT | Picked up | **`PickupIcon`** (NEW) | **Amber ramp** — Amber 100 `#FBE4BD` fill / Amber Deep `#8E5A14` text | observed | ramp step 1; ⚠ Amber 100 is a tint — fill-only, dark text |
| 4 | `ARRIVED_AT_DC` | IN_TRANSIT | At distribution centre | **`DcIcon`** (NEW) | **Amber ramp** — Amber 300 `#F1BF6B` | observed | folds ON_DC/IN_DC wire-spelling |
| 5 | `IN_TRANSIT` | IN_TRANSIT | In transit | `TruckIcon` (existing) | **Amber ramp** — Amber 600 `#C98726` | observed | |
| 6 | `HUB_TRANSFER` | IN_TRANSIT | Hub transfer | **`HubTransferIcon`** (NEW) | **Amber ramp** — Amber Deep `#8E5A14` | inferred | |
| 7 | `OUT_FOR_DELIVERY` | IN_TRANSIT | Out for delivery | **`OutForDeliveryIcon`** (NEW) | **Amber ramp — CORE** Signal Amber `#E8A33C` | observed | **Love-locked: brightest/hi-vis** — highest-attention state |
| 8 | `DELIVERED` | DELIVERED | Delivered | `PodIcon` (existing, `tone="active"`) | **Success** — Grass Green `#3e7c4b` | observed | |
| 9 | `FAILED` | FAILED | Delivery failed | `CautionIcon` (existing) | **Alarm** — Bright Red `#D93A2B` | observed | |
| 10 | `PROCESS_FOR_RETURN` | FAILED | Processing return | **`ReturnIcon`** (NEW, `variant="outline"`) | **Alarm** — Bright Red `#D93A2B` | inferred | shared red; icon+label disambiguate |
| 11 | `RETURNED_TO_SHIPPER` | FAILED | Returned to shipper | **`ReturnIcon`** (NEW, `variant="solid"`) | **Alarm** — Bright Red `#D93A2B` | inferred | one new icon, two variants (cf. `PackageIcon variant="solid"`) |
| 12 | `CANCELED` | CANCELED | Cancelled | none (null glyph) + **strikethrough** | **Neutral** — Stone 600 `#4E4A42`, line-through | observed | keeps current null-glyph + strikethrough treatment |
| 13 | `RESCHEDULED` | ON_HOLD | Rescheduled | **`RescheduleIcon`** (NEW) | **Hold** — Stone 600 `#4E4A42` on Ivory `#F2EEE6` (§3.3.11 ON_HOLD token) | inferred | shared hold colour; icon+label disambiguate |
| 14 | `REATTEMPT` | ON_HOLD | Reattempt scheduled | **`RetryIcon`** (NEW) | **Hold** — Stone 600 `#4E4A42` on Ivory | inferred | |
| — | `TASK_HAS_BEEN_UPDATED` | (null) | *(edit event — not a status)* | — | — | observed | renders nothing; unchanged |

**New icons to build (6 glyphs, existing hand-rolled SVG style → OQ-8):** `PickupIcon`, `DcIcon`, `HubTransferIcon`, `OutForDeliveryIcon`, `ReturnIcon` (outline+solid variants), `RescheduleIcon`, `RetryIcon`. `CANCELED` stays null-glyph + strikethrough (already distinct).

**Amber ramp (recommended; build finalizes exact rungs per OQ-6):** journey-deepening on the four non-core rungs (Amber 100 → 300 → 600 → Deep for Picked-up → At-DC → In-transit → Hub-transfer), with **OUT_FOR_DELIVERY on the hi-vis CORE Signal Amber** so it pops as brightest. Icon + label carry the real distinction, so exact rung choice is non-load-bearing.

**No-clean-colour constraint, RESOLVED by Love's family+icon ruling:** the failure tail (10/11) and the hold pair (13/14) — which had no second distinct hue in the enumeration — are now distinguished by **icon + label within a shared family colour**, exactly as ruled. No new hex required.

---

## §4. Mapper changes — stop the lossy collapse (Layer 1)

Keep the coarse maps for business logic; add fine maps + a fine-advance guard. The applier writes **both** `internal_status` (coarse, mapping unchanged) and `courier_status` (fine, new).

- **`status-mapper.ts`** (`ACTION → internal`): add a sibling `mapSuiteFleetActionToCourierStatus(action): CourierStatus | null` returning the 1:1 fine state (14 actions → 14 fine values; `TASK_HAS_BEEN_UPDATED` and unknowns → `null`). Existing coarse `mapSuiteFleetStatusToInternal` is **unchanged**.
- **`status-progression.ts`** (`status-field VALUE → internal`): add `mapSuiteFleetStatusValueToCourierStatus(value): CourierStatus | null` (the value vocab, incl. the `ARRIVED_IN_DC` spelling → `ARRIVED_AT_DC`). Existing coarse `mapSuiteFleetStatusValueToInternal` + `shouldAdvanceStatus` **unchanged**.
- **Fine-advance guard (new — the load-bearing subtlety).** Today `shouldAdvanceStatus` dedups on coarse status, so a `PICKED_UP → OUT_FOR_DELIVERY` transition is "same coarse (`IN_TRANSIT`) → no-op" and would **never advance `courier_status`**. Add `shouldAdvanceCourierStatus(currentFine, nextFine)` with a **fine linear rank for the in-transit ramp** (`PICKED_UP < ARRIVED_AT_DC < IN_TRANSIT < HUB_TRANSFER < OUT_FOR_DELIVERY`) so the ramp progresses on the fine field and a lagging webhook can't regress `OUT_FOR_DELIVERY` back to `PICKED_UP`. Hard-terminal (`DELIVERED`/`CANCELED`) and SKIPPED guards mirror the coarse rules. **The applier advances each field by its own guard** — coarse may no-op while fine advances within `IN_TRANSIT`.
- **Applier wiring** (webhook handler / task-status repository update): on a status-changing event, compute both mapped values and persist both columns in the existing update path (one `UPDATE`, no new round-trip).

---

## §5. Calendar projection fix — unfold + correct the mislabel (Layer 2)

- **`DayDisplayStatus.projectDayDisplayStatus`** — read `task.courier_status` (fall back to `internal_status` when NULL) and project **without folding or mislabeling**: `IN_TRANSIT` renders "In transit"; `OUT_FOR_DELIVERY` renders "Out for delivery" (the v1.30 timeline lane already treats them as distinct — the calendar now matches). `ASSIGNED`/`CREATED`/`ON_HOLD` stop collapsing into "Scheduled" — each renders its own label/icon/colour. The skip/append exception precedence (SKIPPED/APPENDED) is preserved unchanged.
- **`DAY_DISPLAY_VISUALS`** — expand to cover the fine states with the §3 label/icon/family-colour. The exhaustiveness `never` guard is retained (compile-time coverage).
- **`CalendarStatusLegend`** — the legend grows from 6 → up to 14 (→ OQ-4: recommend **family-grouped** legend — 5 family headers with fine states beneath — over a flat 14-chip row).

---

## §6. The 9 render surfaces + 3 shared maps (surface-by-surface)

**3 shared source-of-truth maps (edited once, propagate):**
1. **`tasks/status.ts` `TASK_STATUS_FILTERS`** — the `/tasks` filter pills. → OQ-3: **keep filters at the coarse 7 lifecycle buckets** (14 filter pills is unusable); the **row** renders the fine `courier_status`. Add a shared `COURIER_STATUS_DISPLAY` map (label + pill class + icon ref per fine state) consumed by all row renders.
2. **`StatusIcon.tsx`** — re-key the dispatcher on `courier_status` (fall back to `internal_status` for NULL), add the 6 new icons; keep `CANCELED`/null-glyph behaviour.
3. **`DayDisplayStatus.ts`** — per §5.

**9 human-facing surfaces (each reads fine `courier_status`, NULL-falls-back to coarse):**
1. `/tasks` operator list (`tasks/client.tsx`) — row pill + glyph fine; **filter pills stay coarse**.
2. `/admin/tasks` cross-tenant list (`(admin)/admin/tasks/page.tsx`) — row pill + glyph fine.
3. Consignee calendar month cells (`CalendarMonthView.tsx`) — via `DayDisplayStatus`.
4. Calendar status legend (`CalendarStatusLegend.tsx`) — expand (OQ-4).
5. Consolidated day view (`calendar/_components/ConsolidatedDayView.tsx`).
6. Day-action popover (`DayActionPopover.tsx`).
7. POD card (`CalendarPodCard.tsx`) — where status shows.
8. Subscription tasks list (`subscriptions/[id]/_components/SubscriptionTasksList.tsx`).
9. **Task timeline drawer (`components/task-timeline/TaskTimelineDrawer.tsx`)** — **#537 is MERGED to `main` (`b1bef3a`, 2026-06-21).** It is now a **normal surface**, no longer DO-NOT-TOUCH. The build lane updates it to render the fine state, **coordinating with the v1.30 move-link feature** that just landed there (no conflict expected — move-link reads audit events; status render reads the task row). → OQ-7.

`tasks/repository.ts` + `tasks/types.ts` (`Task`/`TaskInternalStatus`): add `courierStatus?: CourierStatus | null` to the read model + select it; **no change to `internal_status` typing.**

---

## §7. Migration 0035 (NAMED, exact up/down — NOT CREATED; SQL TO APPLY: no)

**Recommended (Option B) — `supabase/migrations/0035_tasks_courier_status.sql`:**

```sql
-- Up
ALTER TABLE tasks ADD COLUMN courier_status text NULL;
ALTER TABLE tasks
  ADD CONSTRAINT tasks_courier_status_check
    CHECK (courier_status IS NULL OR courier_status IN (
      'ORDERED','ASSIGNED','PICKED_UP','ARRIVED_AT_DC','IN_TRANSIT',
      'HUB_TRANSFER','OUT_FOR_DELIVERY','DELIVERED','FAILED',
      'PROCESS_FOR_RETURN','RETURNED_TO_SHIPPER','CANCELED',
      'RESCHEDULED','REATTEMPT'
    ));
-- nullable: NULL = no SF courier detail yet / Planner-only state (SKIPPED, manual cancel) / pre-backfill row.
-- internal_status CHECK UNCHANGED (still the 8-value 0019 set).

-- Down
ALTER TABLE tasks DROP CONSTRAINT tasks_courier_status_check;
ALTER TABLE tasks DROP COLUMN courier_status;
```

**Alternative (Option A, if Love rules to expand `internal_status` instead) — `0035_tasks_internal_status_courier_expansion.sql`:** DROP/ADD `tasks_internal_status_check` (0019 pattern) extending the IN-list to the 14 courier values + `SKIPPED`. Not recommended (§1). Down restores the 0019 8-value list — **but only after a data migration collapses any new-value rows back**, or the down fails the CHECK; this irreversibility-without-data-touch is part of why B is preferred.

> **This file is NOT created in this PR.** It parks for Love's named SQL authorization at code-PR time, applied per the Day-5 convention (during PR prep, builder-applied) per [[followup_migration_drift_check]].

---

## §8. Migration-safety / backfill (recommend; Love rules at code-PR → OQ-5)

Option B adds a **nullable** column → existing rows are valid immediately (no rewrite, no lock beyond the catalog change). Backfill options:

- **(Recommended) Forward-only + render fallback.** Existing rows keep `courier_status = NULL`; render falls back to the coarse `internal_status` map. New webhooks populate `courier_status` precisely from this point. **Honest** — the 3 lossy families (IN_TRANSIT×5, FAILED×3, ON_HOLD×2) genuinely cannot be disambiguated for historical rows, so inventing a sub-state would be a lie.
- **(Optional) Unambiguous partial backfill.** One-time `UPDATE` setting `courier_status` for the 4 *1:1-recoverable* coarse states only (`CREATED→ORDERED`, `ASSIGNED→ASSIGNED`, `DELIVERED→DELIVERED`, `CANCELED→CANCELED`), leaving the ambiguous families NULL. Nice-to-have; not required for correctness.

> **OQ-5 — recommend forward-only + render fallback** (simplest, honest; the optional partial backfill can ride later if operators want it).

---

## §9. Brief amendment + decision memo (in THIS PR)

- **§3.1.10** — append the courier-status fine model + the A2 "render distinctly, no collapsing" mandate (Love-ruled scope expansion): the 14 distinct courier states, the coarse+fine carrier, and the rule that each renders distinctly by colour-family + icon + label.
- **§3.3.11** — append a "Delivery-status render — colour families + label/icon" note pointing at the §3 table (amber ramp = in-transit journey with OUT_FOR_DELIVERY on hi-vis Signal Amber; red = failure family; Stone-600 = hold family; icon+label disambiguate within a family; no new hex).
- **§9** — new row **v1.31** (next free against `main` at build time; re-confirm/renumber at merge-prep per the recorded fixup rule if a peer bump lands first), additive-only, append-only table. Version header `v1.30 → v1.31`; closing line `End of v1.30. → End of v1.31.`
- **Decision memo:** `memory/decision_d56_phase8_status_distinct_render.md` (named in the §9 row).

---

## §10. Proposed build lanes (reviewer scopes AFTER Love clears)

RED-first each lane per §7.1.

- **Lane 1 — model + migration.** `0035` (Love-authorized SQL) · `CourierStatus` type · `Task.courierStatus` read model + repository select. Tests: type/exhaustiveness; repository returns the column.
- **Lane 2 — mapper.** Fine action/value maps + `shouldAdvanceCourierStatus` (in-transit ramp rank) + applier dual-write. Tests: each action/value → fine state; ramp advance/regress guard; coarse-no-op-while-fine-advances; terminal/SKIPPED guards.
- **Lane 3 — shared render maps + icons.** `COURIER_STATUS_DISPLAY` (label/colour/icon) · 6 new icons · `StatusIcon` re-key + fallback · `TASK_STATUS_FILTERS` stays coarse. Tests: every fine state has a display entry; NULL falls back to coarse; filter parse unchanged.
- **Lane 4 — calendar.** `DayDisplayStatus` unfold + mislabel fix · `DAY_DISPLAY_VISUALS` expand · legend (family-grouped). Tests: IN_TRANSIT≠OUT_FOR_DELIVERY; ASSIGNED/CREATED/ON_HOLD no longer "Scheduled"; exception precedence intact.
- **Lane 5 — surfaces.** Wire the 9 surfaces; **timeline drawer coordinated with merged #537**. Tests: page-test snapshots per surface render the fine label.

---

## §11. Open questions (numbered — one recommendation each; "all recommendations" answerable)

1. **Carrier model:** (A) expand `internal_status` to 14 vs **(B) new nullable `courier_status` + unchanged 8-value `internal_status`**. → **Recommend B** (isolates blast radius from v1.17–v1.30 lifecycle gates; clean forward-only backfill; Planner-only states keep coarse-only).
2. **ARRIVED fold:** treat `ARRIVED_ON_DC`/`ARRIVED_IN_DC` as one `ARRIVED_AT_DC`. → **Recommend yes.**
3. **`/tasks` filter granularity:** coarse-7 filter + fine-14 row render vs 14 filter pills. → **Recommend coarse filter + fine row render.**
4. **Legend density:** flat 14 chips vs family-grouped (5 headers + sub-states). → **Recommend family-grouped.**
5. **Backfill:** forward-only + render fallback vs partial unambiguous backfill. → **Recommend forward-only + render fallback.**
6. **Amber rung exactness:** OUT_FOR_DELIVERY = Signal Amber is Love-locked; the 4 mid-journey rungs are a render detail. → **Recommend the build lane finalizes rungs** (icon+label carry the distinction).
7. **#537 timeline drawer:** now MERGED → normal surface. Update it in Lane 5 vs defer to a follow-up. → **Recommend update in Lane 5, coordinating with the move-link feature** (no expected conflict).
8. **New icons:** hand-rolled in the existing `*Icon.tsx` style vs pull from an icon lib. → **Recommend hand-rolled** (6 glyphs; matches the existing set; no new dependency).

---

## §12. Out of scope / HARD STOP

- No code, no migration file, no render change in this PR.
- `TASK_HAS_BEEN_UPDATED` stays non-lifecycle (renders nothing).
- Outbound status (Planner → SF) unchanged — this is inbound render only.
- **HARD STOP at PR-open.** Reviewer body-reads at the pinned head; lanes are scoped only after Love clears labels + colours + the OQ rulings.
