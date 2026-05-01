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
- [Internal task status lossiness](followup_internal_task_status_lossiness.md) — FAILED collapses transient + terminal failure; add 8th state if pilot feedback confirms the merchant cares
- [SuiteFleet auth rate limits unknown](followup_suitefleet_auth_rate_limits.md) — auth endpoint limits + account-lockout policy undocumented; email SF account manager pre-Day-14
- [createTask single-attempt policy](followup_createtask_idempotency.md) — SF doesn't dedupe and ignores Idempotency-Key (probes 2026-04-29). Code mitigation in place; vendor confirmation outstanding for Day-14. Day-5 update: T-7 SQLSTATE 23505 routing for cron upsert decision
- [paymentMethod dropped from response](followup_paymentmethod_field_resolution.md) — S-9 must verify whether deliveryInformation.paymentMethod is mis-shaped, renamed, or silently ignored by SF

## Day 5 (30 April 2026)

- [Task module — no user-facing create/delete](decision_task_module_no_user_create_delete.md) — Day-5 bimodal design: createTask/bulk system-only, only updateTask + reads are user-flow; T-5 ships 3 endpoints, not 6; no deleteTask method
- [No self-tier escalation](feedback_no_self_tier_escalation.md) — tier is Love's call; never self-escalate or de-escalate. Surface the question pre-PR instead
- [Ephemeral vs durable memory](feedback_ephemeral_vs_durable_memory.md) — `~/Code/planner/memory/` is canonical (git-tracked). The agent-private auto-memory location is scratch only. Survey the durable store at session start

## Day 6 (1 May 2026)

- [Brand guidelines v2 — design tokens](decision_brand_guidelines_v2.md) — Mulish + Sanchez registered for product UI; Manrope is slogan-only and deliberately excluded; 7 working hex tokens not source-of-truth (brand-team confirmation pre-Day-14; brand book pages 27–28 have printed-hex errors)
- [SuiteFleet webhook policy](followup_suitefleet_webhook_policy.md) — additive receiver + per-status routing confirmed; canonical 15-event SF taxonomy captured; Planner subscribed to all 15 on sandbox merchant 588; existing mapper covers all 15 (no code gap)
- [SF outbound base URL — single host validated](followup_suitefleet_base_url.md) — empirical probe (1 May 2026) confirms api.suitefleet.com is the canonical API for all merchants; portal subdomains UI-only; no refactor needed
- [Zod 4 UUID validation](followup_zod_uuid_validation.md) — `.uuid()` enforces RFC 4122 version + variant nibbles; existing 1111-only fixtures fail in Zod-validated paths
- [Route-layer test-coverage gap](followup_route_layer_test_coverage.md) — no `/api/*` route has handler-level tests; Zod parsing, error-mapping precedence, status-code correctness, response-envelope shape have no regression pin
- [Asset tracking MVP design](decision_bag_tracking_mvp.md) — hybrid cache + read-through with 5-min TTL; one row per package; 4-state taxonomy (COLLECTED/EN_ROUTE/RECEIVED/RETURNED) per SF doc §6.2; emit-none on cache reads; asset-tracking-enabled flag derives from inbound webhook payload
- [SF task-asset-tracking API](followup_suitefleet_asset_tracking_api.md) — `?awbs=<AWB>` (NOT `?taskId=`); Spring Data wrapper empirically confirmed; one row per package; 4-state enum `{COLLECTED, EN_ROUTE, RECEIVED, RETURNED}`; 9 open vendor questions
- [Day 6 EOD handoff](handoffs/day-6-eod.md) — sprint summary (8 commits), counter-review patterns, Day-7 carry-forwards. Read before responding to next-session brief.

## Day 7 (2 May 2026)

- [Day 7 schedule drift](notes/day7_schedule_drift.md) — calendar Day 7 ≈ plan Day 9; subscriptions/task modules shipped ahead of plan calendar; today's work is nightly cron batch + DLQ retry + Sentry + MP-13/14 + sweeper service
- [C-3 cron bulk push deferred to Day 8](followup_c3_deferred_day8.md) — consignees has no district column; SF requires it. Captures Day-8 schema migration scope, defaults, Transcorp shipFrom values, and 14 outstanding Aqib questions to fold in on response
- [MP-13 cascade-cancel gap](followup_mp_13_cascade_cancel.md) — consignee deactivation cancelling pending tasks is not enforceable without schema work (no `deactivated_at` column; FK is RESTRICT). C-7 named test pins current FK-violation behavior; Day 8/9 implements Option A soft-delete
- [Day 7 EOD handoff](handoffs/day-7-eod.md) — sprint summary (8 commits + EOD-fill T1), 5 counter-review patterns, watch-items, Day-8 carry-forwards. Read before responding to next-session brief.
- [SF label endpoint](followup_suitefleet_label_endpoint.md) — Aqib-confirmed shape (GET shipment-label.suitefleet.com/generate-label, comma-separated bulk, indv-small format, tz_offset=4); load-bearing security rule: token-in-query MUST NOT reach operator browsers (server-side fetch + stream PDF back); Day 8 T2 commit scope locked
- [SF webhook auth + payload architecture](followup_webhook_auth_architecture.md) — live webhook capture (post-Day-7-close): clientid/clientsecret lowercase headers (NOT Authorization/Bearer/HMAC); body is JSON array of action-keyed events; shipFrom auto-populated by SF (drops tenant-shipping config); customer.code required; pulls webhook auth/parsing/routing from Day 12 to Day 8 T3
