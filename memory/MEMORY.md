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

## Day 8 (3 May 2026)

- [Day 8 schedule note](notes/day8_schedule.md) — calendar Day 8 ≈ plan Day 10; commit plan: D8-1 through D8-7 core (must land), D8-8/9/10 optional; tier mix 2 T1 / 3 T2 / 2 T3 core, up to 2 T1 / 4 T2 / 4 T3 if all optionals land; mid-day handoff trigger at <25% context during D8-2 or D8-4
- [createBulk vs single-loop](followup_createbulk_vs_single_loop.md) — open as of Day 8 morning; single-loop locked default for C-3 cron push; createBulk only acceptable if SF confirms per-task IDs on success AND per-task 23505 semantics on conflict; resolution deadline before D8-4 PR opens
- [D8-4b reconcile-recovered local-write failure](followup_reconcile_recovered_local_write_failure.md) — `markTaskPushed` failure AFTER `getTaskByAwb` succeeded leaves no DLQ row + no audit event (Sentry-only). Day 9 fix: write DLQ with prefix `reconcile_recovered_but_mark_pushed_failed:` carrying the recovered SF id for operator cut-and-paste recovery
- [Vercel auto-promote main → Production policy gap (PRIORITY ELEVATED)](followup_vercel_auto_promote_main_to_production.md) — auto-promote OFF means every urgent main-merge needs a manual `vercel promote`. Hit THREE times on Day 8 (D8-4a, β, D8-5+D8-6 merge). Operational risk vector. Day 9 morning anchor: lean Path A (auto-promote on green CI)
- [D8-6 label-token observability audit](followup_label_token_observability_audit.md) — application logger is host-only, but Vercel/Sentry/APM HTTP instrumentation may auto-capture URLs with the bearer token query param. Pre-Day-14 audit gate
- [D8-6 LABEL_TZ_OFFSET=4 hardcode → must become tenant-derived](followup_label_tz_offset_per_tenant.md) — works for UAE+Oman (UTC+4 year-round); KSA is UTC+3. First non-UAE tenant onboard is the trigger

## Day 9 (3 May 2026)

- [S3_WEBHOOK_ARCHIVE_PREFIX env-scope divergence](followup_env_scope_s3_webhook_archive_prefix.md) — pre-existing var scoped to all three (Dev + Preview + Prod); convention is Production + Preview only. Day-10 cleanup batch.
- [D8-8 webhook auth model — credential-based verification not viable](followup_d8_8_webhook_auth_model.md) — SF webhook auth is opt-in per-merchant; production merchants don't configure Client ID/Secret. D8-8 must use IP allowlist / path-embedded tenant ID / HMAC (vendor-confirmed), NOT credentials. P2 webhook env-add aborted as a result.
- [D8-2 migration comment framing](followup_d8_2_migration_comment_framing.md) — `0013_sf_integration_required_fields.sql` lines 102-104 frame credential verification as default; P2 reshape made it Tier-2-only. Day-10 docs-pass amendment, not D8-8's job.
- [D8-8 Tier-2 401 audit-emit-await latency observation](followup_d8_8_audit_emit_latency_observation.md) — Tier-2 mismatch 401 path awaits auditEmit before responding; fire-and-forget pattern is the future optimisation if production observes elevated p99 on 401s. Counter-reviewer observation at D8-8 PR #86 close; production-observation candidate, NOT a bug.
- [Promotion runbook — first execution findings](followup_promotion_runbook_first_execution_findings.md) — first end-to-end execution of promote-to-prod runbook since R-0-prep surfaced 6-day SHA divergence + ff-only structural impossibility after any backport-via-PR cycle. Runbook amended in same batch (PR #89); production branch protection unchanged.
- [Promotion runbook — local branch-state risk](followup_promotion_runbook_branch_state_risk.md) — after promotion procedure, local branch sits on production; new feature branches must `git checkout main && git pull` first or they parent to production and conflict with main. PR #93→#94 close-and-reopen incident. Day-10 docs-pass amendment.
- [Branch-model audit — Day-10 priority](followup_branch_model_audit.md) — four branch-state issues surfaced across Days 8-9 share root pattern (R-0-prep model correct, supporting infrastructure incomplete). Audit scope: infrastructure / documentation / operator-mental-model layers. Procedural cleanup, batched; doesn't block Day-10 substantive work.
- [Day 9 EOD handoff](handoffs/day-9-eod.md) — sprint summary (11 PRs + 1 closed-and-reopened), 5 reviewer pushback patterns, memory delta (8 new files), Day-10 priorities (P1 branch-model audit, P2 P4b Tier-2 creds, P3 D8-10 cascade-cancel, P4 docs-pass batch). Read before responding to next-session brief.
- [Promotion runbook — add/add conflict pattern (finding #5)](followup_promotion_runbook_addadd_conflict_pattern.md) — second-and-subsequent promotions produce add/add conflicts on every file modified by post-promotion main commits; resolve via `git merge -X theirs origin/main` after verifying precondition `git log origin/main..origin/production` returns only prior squash-merge commits. Surfaced on Day-9 EOD batched promotion (second execution since R-0-prep). Day-10 docs-pass amendment.
- [Branch-model audit results](followup_branch_model_audit_results.md) — three-layer sweep complete. Infrastructure clean; operator-mental-model already captured; documentation layer surfaced 2 NEW wording-drift findings — Drift B (load-bearing) is RUNBOOK.md env-scope wording CONTRADICTING the locked Production+Preview-only convention. Day-10 docs-pass corpus grows from 4 to 6 items. Decision boundary preserved: R-0-prep stays.
- [Auth implementation plan (Day 10 P1)](plans/auth_implementation_plan.md) — approved Day-9 EOD. Pivot driver: MVP sharpened to 3 test merchants × 1000 tasks × 1 operator each by Day 14. Supabase Auth + email/password + @supabase/ssr + per-tenant RBAC via existing role_assignments. Posture A (graceful migration). Test-merchant onboarding CLI bundled in auth PR. T3 hard-stop-twice. Day-10 sequencing: third promotion → auth implementation → onboarding CLI → P2 nav.

## Day 10 (4 May 2026)

- [P4 operator nav + landing page plan](plans/p4_operator_nav_plan.md) — top nav (horizontal header), permission-gated visibility per role, workflow-shortcut landing page (Today's tasks + Failed pushes), logout via POST form to existing /logout. Route-group `(app)/` migration; 4 page moves + 4 new files. T2. Reviewed alongside auth PR; no implementation today.
- [Example data in user-facing help text](followup_example_data_in_user_facing_help.md) — prefer obviously-fake names (acme-corp, example-merchant) in script help/argparse/plan examples. Surfaced when "tabchilli" placeholder triggered a verification loop during P2 probe prep. Audit pass when adjacent edits land.
- [CI-residue cleanup task — probe-merchant-a/b](followup_audit_rule_cascade_conflict_cleanup.md) — companion to audit_rule_cascade_conflict.md. Day-10 P2 probe seeds 2 throwaway tenants on top of the 339-row CI residue; tracks probe-specific teardown path (RULE-disable + DELETE) separately from the wider sweep that stays under the parent memo.
- [Day-10 P2 cross-tenant probe — complete forensic record](followup_probe_complete_day10.md) — full structured table of the 7-step probe (seeded probe-merchant-a/b, drove /login Server Action, ran URL/body/header injection probes, logout, cleared-cookie validation). All vectors rejected; session-bound tenantId is the only scoping source. Useful artifact for Aqib walkthroughs + pre-Day-14 security audit + Posture B retirement verdict update.
- [Auth-token cookie missing HttpOnly + Secure](followup_auth_cookie_httponly_secure.md) — @supabase/ssr 0.10.x setAll callback writes auth-token cookie with SameSite=lax (CSRF-defended ✓) but no HttpOnly or Secure flags. T2 fix in src/shared/request-context.ts cookie adapter; lands before Day-14 MVP go-live. Probe-surfaced.
- [Body-injection probe coverage gap on POST routes](followup_body_injection_probe_post_routes.md) — P2 step 4 returned 405 because /api/tasks is GET-only. Body-injection vector not exercised against a real POST endpoint; architecture safe-by-construction (Zod strips unknown fields, services take ctx not body-tenant_id, RLS scopes via withTenant). T2 watch-item for pre-Day-14 security audit; probe one POST route (/api/consignees) for full coverage.
- [Secrets Manager swap — production-cutover blocker](followup_secrets_manager_swap_critical_path.md) — Day-5 swap to AWS Secrets Manager has slipped 5 days; current env-backed resolver ignores tenantId so every tenant authenticates as SF merchant 588. Acceptable for Day-14 MVP (Path B sandbox-share) but BLOCKS production cutover. Day-15+ scope: resolver swap + IAM + provisioning script + .env.example reconciliation.
- [MVP demo — 3 P3 test merchants share sandbox SF merchant 588](decision_mvp_shared_suitefleet_credentials.md) — Path B accepted Day 10. MPL/DNR/FBU tenants distinct in Planner (slug, UUID, admin login, customer_code) but all push to SF merchant 588 via env-backed creds. Validates Planner-side per-tenant isolation; SF-side isolation gates on Day-15+ Secrets Manager swap. Operators see AWB prefix `MPL-` during sandbox demo regardless of merchant.
- [Migration 0013 customer.code comment is misleading](followup_migration_0013_customer_code_comment_amendment.md) — 0013 header reads as if SF requires `customer.code` field in createTask body; static analysis confirms wire body has no such field. `tenants.suitefleet_customer_code` is purely a cron-gate field (skip if NULL), not a wire-body field. T1 amendment — standalone docs PR or bundle with Secrets Manager swap.
- [Day 10 EOD handoff](handoffs/day-10-eod.md) — sprint summary (12 PRs merged, zero closed-and-reopened), 3 substantive tracks (P1 third promotion + P2 auth implementation + cross-tenant probe), 8 new memos, P3 onboarding seeded MPL/DNR/FBU on shared DB. 11-commit queue against production for Day-11 EOD batched promotion. Read before responding to next-session brief.

## Day 11 (4 May 2026)

- [Double session resolution per request after P4](followup_double_session_resolve_per_request.md) — PR #117 introduced an authenticated-route surface where layout AND page each call buildRequestContext, doubling the supabase.auth.getUser + DB join per request. Surfaced pre-merge; accepted ship-as-is. Fix lands as small T2 follow-up before P5 implementation begins (extract resolveSession() helper, wrap with React cache(), tests use vi.resetModules or test the inner uncached function).
- [P3 subscription seeding plan (Day 12 impl)](plans/p3_subscription_seeding_plan.md) — scripted `seed-subscriptions.mjs` over CSV import; per-merchant variation in cadence + plan archetype + delivery zones (MPL veggie 5-day Dubai, DNR medical 7-day Dubai+Sharjah, FBU butcher 2-day Dubai+AbuDhabi); 200/145/500 consignees per merchant to land ~1000 tasks/wk per cadence; start-fresh-from-today (no historical backfill); DECISION NEEDED on whether MVP's "1000 tasks" is cumulative-by-Day-14 or visible-on-Day-14.
- [Day 11 EOD handoff](handoffs/day-11-eod.md) — sprint summary (4 PRs merged + 1 EOD-fill), one substantive track (P4 operator nav), fourth-since-R-0-prep promotion executed clean (no Posture A leak in production), 2 new memos. 3-commit queue against production for Day-12 EOD promotion. Day-12 sequencing locked: double-resolve fix FIRST → P5 /tasks page → P3 seeding impl → EOD promotion. Volume-target decision LOCKED: cumulative-by-Day-14, NOT visible-on-Day-14. Read before responding to next-session brief.
