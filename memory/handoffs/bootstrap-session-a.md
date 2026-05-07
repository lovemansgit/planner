---
name: Session A bootstrap — Day-17 PM, mid-calendar-implementation
description: Pre-context-compact bootstrap for Session A's calendar Week view + click-into-day popover work (Day-17 substantive #2). Filed proactively given context budget pressure + scope size. Captures today's full PR ledger, current sequence position, calendar-PR scope decisions, and explicit pickup pointer.
type: project
---

# Session A bootstrap — Day-17 PM, mid-calendar-implementation

**Filed:** Day 17 (7 May 2026), afternoon, mid-PR-#175-or-later session.

---

## §1 Today's PR ledger (14 merged, 1 open from Session B)

| # | PR | Tier | Merge SHA | Delivered |
|---|---|---|---|---|
| 1 | #162 | T1 | `c31b4fb` | Day-16 plan-sync bundle (5 net-new memos + 14-item Day-16 index backfill) |
| 2 | #163 | T1 | `ed61f35` | Day-17 CRM state UI plan v1.0 |
| 3 | #164 | T1 | `5cb6e34` | Brief v1.4 amendment |
| 4 | #165 | T1 | `8b5074b` | Logo asset commit (PNG) |
| 5 | #166 | T1 | `53ab411` | Brand tokens + Manrope load |
| 6 | #167 | T1 | `69bad24` | CRM plan v1.0 → v1.1 amendment |
| 7 | #169 | T1 | `fa6ad1e` | Brief v1.5 + token color canon |
| 8 | #168 | T2 | `f22cb93` | T2 #1 app-shell brand pass + UserMenu (Path B) |
| 9 | #170 | T2 | `11e40e3` | T2 hotfix — drizzle array-binding bug (`listVisibleTaskIds` + tenant-admin-invariant) |
| 10 | #171 | T1 | `b414da2` | Day-17 frontend gap audit memo |
| 11 | #172 | T2 | `0fee213` | T2 hotfix — Planner UUID → SF external_id translation in label print |
| 12 | #173 | T1 | `eb11e43` | Brief v1.6 — labels proxied as-is, no logo swap |
| 13 | #126 closed | — | — | Stale Day-11 EOD memo PR closed without merge |
| 14 | #174 | T2 | `3b88536` | [Session A] CRM state UI implementation (detail page + tabs + modal) |
| 15 | #175 | T2 OPEN | — | [Session B] Tasks page-size dropdown + select-all-across-pages (in flight) |

**Main HEAD: `3b88536`** (post Session A CRM merge). Session B's PR #175 is open with dependent uncommitted state in shared workspace.

---

## §2 Production lag

13 commits unpromoted. Production deployment still at Day-16 EOD (`dpl_EEJtUU9NVjSKZk1p6RF1sjAfpSUc`); next promote will carry significant payload (logo + brand + CRM + label fixes + scaffolding). No promote yet today; next batched promotion likely Day-17 EOD.

---

## §3 Calendar PR (in flight) scope decisions

**Branch:** `day17/session-a-calendar-week-view`

**Reviewer-spec ambitious scope:** week view + click-into-day popover with 7 actions (skip default / skip with target_date_override / skip-without-append / pause / address one-off / address forward / cancel delivery), each with secondary mini-modals where needed, server actions, integration tests.

**Recommended pragmatic scope (Path A from this turn) given context budget + demo timing:**

**Ship in this PR:**
- `CalendarWeekView` — 7-column week grid; default current week (Monday-anchored ISO); URL state `?week=YYYY-MM-DD`; prev/next/Today nav
- Per-day task card showing status + time window + address label
- `DayActionPopover` client component — opens on day click; permission-gated action list
- ONE working action (skip default) wired through a server action with `revalidatePath`
- Permission gates per brief §3.3.10 — hide buttons for actions actor lacks
- `listTasksByConsigneeAndDateRange` repo fn + `getConsigneeTasksForDateRange` service fn
- Server action: `skipDeliveryAction`
- Helper-only tests for week-anchoring math + permission filtering

**DEFER to follow-up PRs:**
- 6 other actions (target_date_override, skip-without-append, pause, address one-off, address forward, cancel) — each requires its own secondary modal or date picker; together they're a separate workstream
- Month / Year views (per brief §3.3.3 — Week is the demo default; Month/Year are Day-18 polish)
- Driver name / POD photo / rating display (cached webhook surfaces — separate Day-17 substantive #4 per brief §3.3.6)

**Demo-criticality assessment:**
- Week view + skip-default action = brief §5.1 demo arc Section 4 ("Click future Wednesday → click Skip → preview shows tail-end reinsertion → confirm → calendar updates"). LOAD-BEARING for demo.
- Other 6 actions = nice-to-have; demo can show "we have skip + pause; here's how more advanced overrides would work" via brief mention.

---

## §4 Active discipline rules (from prior session work)

### §A REGISTERED-METADATA-WINS (Day-16 origin)

Registered `metadataNotes` at `src/modules/audit/event-types.ts` is canonical for audit body shape. STOP and surface when reviewer drafting drifts.

### Pattern E — uuid[] array-binding (PR #170 + #172)

```typescript
sqlTag`WHERE col = ANY(${'{' + arr.join(',') + '}'}::uuid[])`
```

Type-restricted to uuid[] / integer[] only. Documented at `src/shared/sql-helpers.ts`. Calendar PR's repo fn does NOT need this (single tenant_id + consignee_id + date range; no array binding).

### Barrel-import discipline (PR #174 fix)

Client components MUST import directly from sub-modules (`@/modules/<module>/types`, `@/modules/<module>/transitions`), NEVER from `@/modules/<module>` barrel. The barrel re-exports server-side surfaces (service.ts → @/shared/db → postgres-js); pulling that into a client bundle triggers Turbopack `Module not found: Can't resolve 'fs'`.

For calendar work: `DayActionPopover` (client component) MUST follow this pattern. Likely needed:
- `import type { Task, TaskInternalStatus } from "@/modules/tasks/types"` — direct
- `import type { Consignee } from "@/modules/consignees/types"` — direct
- NEVER `import { Task } from "@/modules/tasks"` from a client component

### Standing 10% bootstrap rule

If context drops below ~10% remaining, file follow-up bootstrap doc before continuing. THIS doc is the proactive filing for Session A's calendar work.

---

## §5 Repo state at write-time

- **Main HEAD:** `3b88536` (post PR #174 merge)
- **Current branch:** `day17/session-a-calendar-week-view` (cut from main; no commits yet)
- **Working tree:** Session B's uncommitted state still in shared workspace — `tasks/*` files modified + `scripts/probe-sf-label-cap.mjs` untracked + `src/app/api/tasks/visible-ids/` new dir. NONE of these are Session A files; explicit `git add` of Session A paths only at commit time.
- **Open PRs:** PR #175 (Session B's tasks page enhancements)

---

## §6 If auto-compaction fires here, the next builder turn picks up at:

**Step 2 of the calendar workstream:** implement calendar data layer.

1. Add `listTasksByConsigneeAndDateRange` to `src/modules/tasks/repository.ts` — standard parameterized SELECT, not Pattern E.
2. Add `getConsigneeTasksForDateRange` to `src/modules/tasks/service.ts` — permission gate `task:read`, no audit emit.
3. Export from `src/modules/tasks/index.ts`.

Then Step 3 (CalendarWeekView component) and Step 4 (DayActionPopover client component with skip-default action only per pragmatic scope §3 above).

Files expected to be created/modified in this PR:
- `src/modules/tasks/repository.ts` (modified — new fn)
- `src/modules/tasks/service.ts` (modified — new fn)
- `src/modules/tasks/index.ts` (modified — export)
- `src/app/(app)/consignees/[id]/_components/CalendarWeekView.tsx` (NEW)
- `src/app/(app)/consignees/[id]/_components/DayActionPopover.tsx` (NEW; client component)
- `src/app/(app)/consignees/[id]/_calendar-actions.ts` (NEW — server actions)
- `src/app/(app)/consignees/[id]/page.tsx` (modified — Calendar tab no longer placeholder)
- Tests for week-anchoring math + permission filtering

The reviewer-spec listed 7 actions; pragmatic scope is to ship 1 (skip default) with extensibility for the other 6. Follow-up PRs handle the additional actions individually.
