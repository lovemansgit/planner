> Durable memory notes live in this directory and are tracked in git. Private agent memory at `~/.claude/projects/.../memory/` is for ephemeral working notes only.

## Day 2 (27 April 2026)

- [Vercel env scope convention](feedback_vercel_env_scope_convention.md) — Production + Preview only, never Development
- [Migration drift check](followup_migration_drift_check.md) — migrations land in git but not on DB; add CI check post-Day-2
- [Audit-rule cascade conflict](followup_audit_rule_cascade_conflict.md) — 0002's audit_events_no_delete RULE breaks ON DELETE CASCADE from tenants
- [Day-2 brief §6 clarification](project_day2_brief_section6_clarification.md) — Tenant Admin does NOT get systemOnly migration perms; reasoning paragraph wins over matrix line
- [Audit failed-attempts gap](followup_audit_failed_attempts.md) — service methods only audit on success; add denied-event vocabulary + try/catch wrapper post-Day-2

## Day 3 (28 April 2026)

- [Phone display readability](followup_phone_display_readability.md) — E.164 storage stays; UI layer needs humanised formatter for operator-facing views
- [Server-component error handling](followup_server_component_error_handling.md) — every page must explicitly decide designed-page vs. 500 per AppError subclass; auth-wiring PR is the audit forcing function

## Day 3 EOD review (28 April 2026)

Onboarding doc review (`aqib.a` × 5 comments) and operational decisions:

- [Team Management UI](followup_team_management_ui.md) — post-MVP screen for inviting internal users
- [Planner auth independent of SuiteFleet](decision_planner_auth_independent.md) — Supabase Auth, separate store, no sync
- [Consignee-only bulk import](question_consignee_only_bulk_import.md) — Phase-2 question for product
- [Task editability cuts off at "assigned"](decision_task_editability_cutoff_at_assigned.md) — global Transcorp rule, lock at TASK_HAS_BEEN_ASSIGNED webhook
- [Failed-payload DLQ split](decision_failed_payload_dlq_split.md) — foundation MVP (Day 6), UI post-MVP
- [Daily cutoff and SuiteFleet push throughput](decision_daily_cutoff_and_throughput.md) — 16:00–17:00 generation window, 5 req/sec, 7K tasks/day cap

## Day 4 (29 April 2026)

- [Vitest project alias duplication](followup_vitest_project_alias_duplication.md) — vitest 4 projects don't inherit resolve.alias; SRC_ALIAS declared 3× — collapse on vitest 5+ upgrade
- [Credential resolver type narrowing](followup_credential_resolver_type_narrowing.md) — `as string` casts in suitefleet-resolver.ts; single-guard refactor removes them, ties to Day-5 Secrets Manager touch
