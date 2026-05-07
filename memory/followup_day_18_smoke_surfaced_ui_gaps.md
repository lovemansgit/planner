---
name: Day-17 EOD smoke surfaced 4 UI gaps for Day-18 morning fix — sign-in logo, tasks-page columns + consignee-name + AWB/order-search, POD-as-icon column
description: Love's Day-17 EOD smoke verification on main-branch preview surfaced 4 UI items NOT blocking tonight's batched promotion (none are integration bugs; all are surfacing/UX work) but load-bearing for Day-18 morning before demo dry-runs. Filed as Day-18 priority queue.
type: project
---

# Day-18 morning UI gap fixes from Day-17 EOD smoke

**Surfaced:** Day 17, ~15:00 Dubai. Love walked main-branch preview smoke after PR #177 merge. Calendar Week view + skip-default + CRM state UI all passed clean. Webhook handler bug also surfaced; that's tracked separately in `followup_webhook_handler_status_pod_date_sync_bug.md`.

## §1 Sign-in page brand pass

**Surfaced:** Sign-in page (`/login`) renders without Transcorp logo. Looks bare; demo panel sees this surface briefly during demo Section 1 setup.

**Fix scope:** Add logo + wordmark per #168 brand pattern. Layout: logo above email/password form. Reuse the SVG logo + Manrope wordmark composition from app-shell header.

**Effort:** ~30 min Day-18 morning.

**Out-of-scope:** Sign-in page broader rework (forgot password, MFA UX, etc.) is post-MVP.

## §2 Tasks page consignee name column

**Surfaced:** `/tasks` page row data shows merchant name + AWB but does NOT show consignee name. Operator workflow needs consignee name visible at row level for triage.

**Fix scope:** Add consignee name column to `/tasks` page. Repository-layer JOIN on consignees already exists per the existing surface; surface the field at row render. Likely 1-line query change + 1 column header + 1 cell.

**Effort:** ~30 min Day-18 morning.

## §3 Tasks page search by AWB + order number

**Surfaced:** `/tasks` page lacks search input. Love's spec: search by AWB and order number.

**Fix scope:** Add search input (debounced) above tasks list; filter on `LIKE` against `external_id` (AWB) + `order_number` (if column exists; verify in repository). URL-state via `?q=` param.

**Effort:** ~1 hr Day-18 morning.

**Out-of-scope:** Full-text search, filter chips, advanced search modal — Phase 2.

## §4 Tasks page column order + POD-as-icon column

**Surfaced:** Love's spec for column order: Merchant Name, Consignee Name, AWB, Order #, Time Slot, Delivery Date, Status, POD link.

POD column treatment: icon at end of row that opens POD photo as a popup (modal) when clicked. Most merchants want quick POD viewing during task triage.

**Fix scope:**
- Reorder columns per spec
- Add POD icon column rendering only when task is DELIVERED + has cached POD URL
- Click handler opens POD photo as modal (existing modal infrastructure from CrmStateModal can be the pattern)
- Fall back to "No POD available" placeholder when DELIVERED task lacks POD (which is the webhook handler bug; once that fix lands, POD URLs will populate)

**Effort:** ~1.5 hr Day-18 morning. Couples with webhook handler fix — POD column has no data to display until webhook handler fix lands.

## §5 Sequencing for Day-18 morning

Dependency: §4 (POD column) coupled with webhook handler fix. Other items independent.

Recommended order:
1. Webhook handler Layer-1 scoping check (15 min, per Day-18 morning first action in EOD doc)
2. Webhook handler fix (separate followup memo) — fixes data flow
3. §1 sign-in logo (independent, fast)
4. §2 consignee name column (independent, fast)
5. §3 AWB + order search (independent, medium)
6. §4 column reorder + POD icon + modal (couples with webhook fix)

All five together: ~3.5 hr UI work + webhook fix budget per Layer-1 outcome. Conditional on Layer-1 verdict.

## §6 Cross-references

- `memory/followup_webhook_handler_status_pod_date_sync_bug.md` (this PR's sibling memo)
- `memory/PLANNER_PRODUCT_BRIEF.md` §5.1 demo Section 4 (POD click-into-day reveals POD photo)
- `memory/PLANNER_PRODUCT_BRIEF.md` §6 Day 18 work plan
- `src/app/(app)/tasks/*` (Session B's Day-17 tasks page enhancements; Day-18 work composes against)
- `src/app/(app)/login/*` (Session A's Day-18 sign-in logo work lands here)
