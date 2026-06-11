# Transcorp admin global view — Phase 1.5

**Filed:** Day 18, 8 May 2026 (afternoon)
**Trigger date:** between Day 25 (post-internal-demo May 15) and Day 28 (external-demo May 18)
**Tier when triggered:** T3 (new admin pages + service-layer cross-tenant fns + new systemOnly permissions)

## §1 What's deferred

Per Love's Day-18 PM ruling: the Transcorp admin operator should have a cross-tenant view of all tasks, all consignees, all subscriptions across all merchants, with merchant-filter and full operator+admin functionality combined.

Out of scope for May-15 internal CAIO demo. In scope between internal demo and May-18 external demo.

## §2 Scope when triggered

Three new admin surfaces minimum:
- /admin/tasks — all tasks across all merchants
- /admin/consignees — all consignees across all merchants
- /admin/subscriptions — all subscriptions across all merchants

Each with merchant filter dropdown.

Three new systemOnly permissions:
- task:read_all
- consignee:read_all
- subscription:read_all

Service-layer cross-tenant fns via withServiceRole BYPASSRLS pattern (matches existing merchants admin).

## §3 Effort estimate

6-10 hours of code post-A2 ship.

## §4 Cross-references

- memory/plans/day-18-transcorp-sysadmin-onboarding.md (sysadmin role provisioning)
- memory/followup_admin_middleware_phase2.md (transcorp-staff discrete role slug deferral)
- memory/followup_admin_merchant_list_filter_internal_tenant.md (is_internal flag deferral)
- memory/PLANNER_PRODUCT_BRIEF.md §2.1 (current single-tenant operator framing)
