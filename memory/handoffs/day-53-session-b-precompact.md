---
name: Session B pre-compact handoff — R6-part-1 scoping state (Day-53)
description: Full locked scoping state for the R6-part-1 build (Tasks-page consignee-context columns) so it survives compaction. Data-layer design, Ruling-2 column resolution, file:line grounding from research, and open threads. The next dispatch is the R6-part-1 build.
type: reference
---

# Session B pre-compact handoff — R6-part-1 build, fully scoped

Captures the locked state so the build needs no re-derivation after compaction.
**No migration. No brief bump (Plan-A). Touches ONLY `src/modules/tasks/**` +
`src/app/(app)/tasks/**`** — clear of every do-not-touch lane. RED-first; the
code-PR parks for Love.

## 1. Locked data-layer design

**Query site:** `listTasksByTenant` in `src/modules/tasks/repository.ts:605-645`
(this is what powers `/tasks`; the public `listTasks` delegates to it; there is
**no** `listTasksWithSearch`).

**JOIN shape (the change):**
- Today the `consignees` join is CONDITIONAL — only added when a search term is
  present (`needsConsigneeJoin(searchTerm)` at `repository.ts:615`, helper at
  `:648`). **Make it UNCONDITIONAL.** `addresses` is **never** joined today — **add
  it** on `tasks.address_id`.
```sql
LEFT JOIN consignees c ON c.id = t.consignee_id AND c.tenant_id = t.tenant_id   -- now UNCONDITIONAL
LEFT JOIN addresses  a ON a.id = t.address_id    AND a.tenant_id = t.tenant_id   -- NEW
```
- Keep `needsConsigneeJoin` as a helper (it is still used by another query at
  `repository.ts:1005`); just stop gating THIS query's consignee join on it. The
  existing search ILIKE already references `c.name`, so an always-on join is safe.

**Effective-address projection + fall-through rule:**
- `tasks.address_id` IS the effective address FK — it already holds the R4/R5
  override winner (written at materialization / by `updateTask`'s `addressId`
  patch, `repository.ts:1210`). So there is **NO runtime COALESCE over exceptions**
  needed; the FK is pre-resolved.
- Fall-through: when `t.address_id IS NULL` (legacy/quarantined rows), fall back
  to the consignee's own address fields. Implement as COALESCE in the SELECT:
```sql
SELECT t.*, <existing packages json>,
  c.name              AS consignee_name,
  c.phone             AS consignee_phone,
  COALESCE(a.line,     c.address_line)        AS effective_address_line,
  COALESCE(a.district, c.district)            AS effective_district,
  COALESCE(a.emirate,  c.emirate_or_region)   AS effective_emirate
```
- **Column-name divergence to NOT trip on:** `addresses` uses `line` / `district`
  / `emirate`; `consignees` uses `address_line` / `district` / `emirate_or_region`.
  (`addresses` has no phone — phone is only `consignees.phone`.)

**TaskListRow type sketch** (do NOT widen the shared `Task`/`TaskRow`/
`TaskRowWithPackages` — `TaskRowWithPackages` is reused by ~7 queries at
repository.ts:428/582/622/685/1045/1213/1297, so widening it leaks null columns
everywhere):
```ts
// src/modules/tasks/types.ts — NEW, alongside Task (types.ts:149-239)
export interface TaskListRow extends Task {
  readonly consigneeName: string | null;
  readonly consigneePhone: string | null;
  readonly effectiveAddressLine: string | null;
  readonly effectiveDistrict: string | null;
  readonly effectiveEmirate: string | null;
}
```
- New DB row type `TaskRowWithConsignee = TaskRowWithPackages & { consignee_name; consignee_phone; effective_address_line; effective_district; effective_emirate }` (snake) + a new mapper `mapTaskListRow(row): TaskListRow` = `{ ...mapTaskWithPackages(row), consigneeName: row.consignee_name, ... }`.
- `listTasksByTenant` return type → `readonly TaskListRow[]`; public `listTasks` → `readonly TaskListRow[]`; `page.tsx` `TasksClientProps.initialTasks` → `readonly TaskListRow[]`. Existing `Task` consumers elsewhere are unaffected (TaskListRow extends Task).

## 2. Ruling-2 column resolution (as I will implement it)

Recorded on main in the spec's Day-53 PM amendment (`diagnostic_calendar_management_full_surface_enumeration.md`, via #414 @`69beb9fa`). The table becomes the **9 ruled data/scan columns**, Date-first:

1. Date · 2. AWB · 3. Status · 4. Consignee Name · 5. Address · 6. District · 7. Emirate · 8. Telephone · 9. Actions

Plus the preserved proven-flow affordances (Love's Ruling 2):
- **KEEP** the leading bulk-select checkbox (bulk print-labels) — a leading control column, not counted among the 9 data columns.
- **Fold POD into the Actions column** (col 9) — UAT step D stays reachable as a per-row action (today it is its own `PodCell` column).
- **Render Issues / failed-push state on the Status badge** (col 3) — today it is its own "Issues" column.
- **Order # and Window are DROPPED** as standalone columns (not in the ruled 9, not rescued by Ruling 2). Order # stays searchable via the existing filter. ⚠️ **FLAG to Love at build-park** — confirm the drop.
- **R6.4:** columns 4–8 (Name·Address·District·Emirate·Telephone) render as ONE contiguous click target → `/consignees/[id]`, hover spans the block. **Telephone is plain TEXT, NOT a `tel:` link.**
- **Horizontal scroll this pass** — wrap the table in `overflow-x-auto` (there is none today). **Column-collapse / responsive stays Tier-2** (deferred).
- Three interactive zones per row: AWB cell (R6-part-2, see below), consignee block (→ detail page), Actions (incl. folded POD).

## 3. File:line grounding (from Day-53 research — do not re-derive)

- **Query:** `listTasksByTenant` `repository.ts:605-645`. Row types: `TaskRow` `:86`, `TaskRowWithPackages` `:129`. Mappers: `mapTask` `:213`, `mapTaskWithPackages` `:307`. Helpers: `needsConsigneeJoin` `:648`, `buildTaskSearchFilter` `:653`. `ListTasksOpts` `:541`.
- **Task DTO:** `src/modules/tasks/types.ts:149-239` — fields incl. `consigneeId`, `externalTrackingNumber` (AWB), `internalStatus`, `deliveryDate`, `addressId` (FK addresses), `addressLabel`. NO consignee name/address text on the DTO today.
- **Address fall-through sources:** `tasks.address_id` added in migration `0014` (`ALTER TABLE tasks ADD COLUMN address_id uuid REFERENCES addresses(id)`); `addresses` table `0014:121-137` (cols `line`,`district`,`emirate`,`is_primary`,`label`,`consignee_id`). Consignee default: `consignees` `0004` + `0013` (cols `name`,`phone`,`address_line`,`district`,`emirate_or_region`). `tasks.address_id NULL` = legacy/quarantined → fall through.
- **Tasks page UI:** `src/app/(app)/tasks/client.tsx` — table inline (thead/tbody `255-291`), current cols `checkbox|Status|Order#|Delivery date|Window|AWB|Issues|POD|Actions`, rows keyed `task.id` `:282`. AWB cell `348-358`. `ActionsCell` `403-438` (Cancel enabled iff `subscriptionId !== null`; Edit always). PodCell is its own column today. **No `overflow-x` wrapper today.**
- **Tasks page data flow:** `src/app/(app)/tasks/page.tsx:84-188` calls `listTasks(ctx, {limit,offset,status,searchTerm,dateFrom,dateTo})`; `TasksClientProps` `167-173` (`initialTasks: readonly Task[]`, `failedPushTaskIds`, `totalCount`, `status`, `printLabelsMaxPerRequest`).
- **Tests (RED-first homes):** `src/modules/tasks/tests/repository.spec.ts` (the unconditional-JOIN + effective-address projection RED), `service.spec.ts`. App-level: `src/app/(app)/tasks/tests/` has only `pod-state.spec.ts` + `status.spec.ts` — a new `client`/table column spec would be a new file.
- **DO-NOT-TOUCH (Session C lane):** `TaskTimelineDrawer.tsx` at `src/app/(app)/consignees/[id]/_components/`; `getTaskTimelineAction` at `src/app/(app)/consignees/[id]/_calendar-actions.ts:493`. R6-part-1 imports NEITHER (the table renders without the drawer this pass).
- **No migration** — every column needed already exists.

## 4. Open threads

- **#411** (runbook firing-as-clearance + builder clearance-merge constraint + the hardening followup `memory/followup_clearance_merge_into_action.md`) is **parked-t3 awaiting Love's MANUAL merge** — the builder is classifier-blocked from merging a PR whose content documents the clearance-merge authority. APPROVE r2, CI green @`4328ff4`. One click from Love lands it.
- **R6-part-2** (AWB→TaskTimelineDrawer entry point + R6.3 partial-state banner) is **blocked on Session C's shared relocation** of the drawer + action out of `consignees/[id]/**` — recorded in `memory/followup_r6_part2_awb_drawer.md`.
- **Tier-2 UI sequence** (`memory/decision_d53_tier2_pre_uat_ruling.md` — Session C filing it: foundation tint fix H4 + polish bundle as ONE PR) is Session B's NEXT work **but only AFTER R6-part-1 lands** (same-page collision).
- **Order # / Window drop** — flag for Love's confirm at R6-part-1 build-park.

## Cross-references
- `memory/diagnostic_calendar_management_full_surface_enumeration.md` — R6 spec + Day-53 column amendment (the build contract).
- `memory/decision_d53_plan_a_pre_uat_queue.md` — the Plan-A wave R6 sits in.
- `memory/followup_r6_part2_awb_drawer.md` — the split-out part-2.
