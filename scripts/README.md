# `scripts/`

Operator-run Node + shell scripts that live outside the Next.js app surface — onboarding, seeding, probes, smoke tests, and the demo-day preflight gate.

All `.mjs` scripts read environment variables from `.env.local` (load pattern: either `import { config as loadEnv } from "dotenv"; loadEnv({ path: ".env.local", quiet: true });` at the top of the script, or `set -a && . .env.local && set +a` before exec). The canonical DB connection uses [`postgres`](https://github.com/porsager/postgres) via `postgres(process.env.SUPABASE_DATABASE_URL, { max: 1, prepare: false })`.

---

## Demo-day procedure

Per [brief §5.3](../memory/PLANNER_PRODUCT_BRIEF.md), the demo preflight runs **twice on demo day**:

1. **At start of dry-run** (typically morning T-2 hours)
2. **30 minutes before live demo**

The first run catches stale seed data, missing cron ticks, or env-drift from overnight. The second run catches anything that broke during the dry-run rehearsal. If any gate fails, stop and either fix the underlying state or fall back to the recorded screen capture per brief §5.3 closing line.

```bash
# Run from repo root with .env.local present
./scripts/demo-preflight.sh

# Or invoke the .mjs directly with env pre-sourced
set -a && . .env.local && set +a
node scripts/demo-preflight.mjs
```

Exit code 0 = all 10 gates pass = **demo-ready**. Non-zero = stop and remediate.

For tightest cron-recency signal (Gate 4), run **after** the daily 16:00–17:00 Asia/Dubai cron tick has fired.

---

## Script inventory

### Demo + onboarding

| Script | Purpose |
|---|---|
| `demo-preflight.mjs` | 10-gate pre-demo verification per brief §5.3 (and v1.10 amendment for Gate 8). Exits 0 on all-pass, non-zero on any fail. |
| `demo-preflight.sh` | Shell wrapper that sources `.env.local` then exec's `demo-preflight.mjs`. Use this in CI or operator runbook. |
| `onboard-merchant.mjs` | Idempotent tenant + tenant-admin user provisioning. Accepts `--slug=…`, `--name=…`, `--admin-email=…`, `--customer-code=…`. Used to provision `meal-plan-scheduler`, `dr-nutrition`, `fresh-butchers`, and demo merchants. |
| `onboard-transcorp-sysadmin.mjs` | Provisions the Transcorp sysadmin user with `transcorp-sysadmin` role. |
| `teardown-merchant.mjs` | Inverse of onboard. Removes tenant + cascade-deletes dependent rows. Destructive — confirm tenant slug before running. |

### Seeding

| Script | Purpose |
|---|---|
| `seed-subscriptions.mjs` | Full subscription dataset seed — consignees + addresses + subscriptions + rotations. Drives the `MERCHANT_PROFILES` catalogue. |
| `seed-subscriptions-config.mjs` | Pure-data `MERCHANT_PROFILES` catalogue (no DB). Imported by `seed-subscriptions.mjs` and pinned by `tests/unit/seed-subscriptions-config.spec.ts`. |
| `seed-demo-personas.mjs` | Seeds the four demo personas (Fatima Al Mansouri address rotation, Sarah Khouri FAILED-deliveries history, plus 2 supporting). Run after `seed-subscriptions.mjs`. |
| `backfill-subscription-materialization.mjs` | Backfills `subscription_materialization` rows for existing subscriptions. Idempotent. |

### Smoke tests + probes

| Script | Purpose |
|---|---|
| `post-deploy-verify.mjs` | Post-deploy smoke — quick subscription/task count + cron-recency check. Faster than `demo-preflight.mjs`; run after every Vercel promote. |
| `posture-b-preflight-probe.mjs` | 4-gate auth-posture audit (Day-20 / Phase 1 readiness gate). |
| `sandbox-smoke-task-create.mjs` | Creates a single SF task end-to-end through the publisher → outbound queue → SF API → webhook acknowledgement path. |
| `sandbox-smoke-dedupe-probe.mjs` | Verifies the dedup/idempotency-key flow rejects duplicate task creates within the dedup window. |
| `sandbox-smoke-idempotency-key-probe.mjs` | Variant of the dedup probe focused on the idempotency-key surface specifically. |
| `probe-sf-bulk-cancel-shape.mjs` | Probes the SF bulk-cancel API to determine the actual request/response shape. |
| `probe-sf-cancel-status-field.mjs` | Determines whether SF cancel uses a `status` field or alternate semantics. |
| `probe-sf-cancel-status-field-inspect.mjs` | Single-task inspector variant of the cancel-status-field probe. |
| `probe-sf-label-cap.mjs` | Tests SF label-printing endpoint for the per-call task-count cap. |

### Infrastructure

| Script | Purpose |
|---|---|
| `setup-test-db.sh` | CI test-database provisioning. Used by GitHub Actions before running the integration test project. |

---

## Demo-merchant identity reference

For quick lookup (canonical source: [`memory/decision_mvp_shared_suitefleet_credentials.md`](../memory/decision_mvp_shared_suitefleet_credentials.md)):

| Code | Slug | `suitefleet_customer_code` | Admin email |
|---|---|---|---|
| MPL | `meal-plan-scheduler` | `588` | `mpl-admin@planner.test` |
| DNR | `dr-nutrition` | `586` | `dnr-admin@planner.test` |
| FBU | `fresh-butchers` | `578` | `fbu-admin@planner.test` |
| Transcorp | (transcorp-staff) | — | `transcorp-admin@planner.test` |

The shared `transcorpsb` SF client_id is the sandbox-region credential; per-tenant routing happens via `customerId` in each `createTask` wire body (resolver thread per `customerId`).

---

## Env-var prerequisites

Most scripts need:

- `SUPABASE_DATABASE_URL` — superuser/BYPASSRLS connection pool (port 6543, transaction pooler)
- `SUPABASE_APP_DATABASE_URL` — `planner_app` role (NOBYPASSRLS) pool, used by app surface; some seed/teardown scripts also call here

SuiteFleet probes additionally need:

- `SUITEFLEET_SANDBOX_API_BASE_URL` (default `https://api.suitefleet.com/api`)
- `SUITEFLEET_SANDBOX_USERNAME`
- `SUITEFLEET_SANDBOX_PASSWORD`
- `SUITEFLEET_SANDBOX_CLIENT_ID`
- `SUITEFLEET_SANDBOX_ACCOUNT_ID`
- `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_ID`
- `SUITEFLEET_SANDBOX_WEBHOOK_CLIENT_SECRET`

QStash workflows (cron + outbound-push retry) need:

- `QSTASH_URL`
- `QSTASH_TOKEN`
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`
- `QSTASH_FLOW_CONTROL_KEY` (locked: `sf-push-global-mvp` for production, `sf-push-global-preview` for preview)

Full env-var list in [`.env.example`](../.env.example).

---

## Adding a new script

1. Use the `.mjs` extension (Node ESM, matches existing convention).
2. Load env via `dotenv` from `.env.local` OR rely on a shell-wrapper to source env before invoking.
3. Use the canonical postgres-js connection options: `{ max: 1, prepare: false }` (add `idle_timeout: 5` for long-lived helpers).
4. Output via plain `console.log` + emoji-only markers (`✓` / `✗`) — no `chalk`, no ANSI escapes (matches existing convention).
5. Exit 0 on success, non-zero with descriptive message on failure.
6. Add a one-line entry to this README under the appropriate section.
7. If the script has any pure logic (config catalogue, parsing helpers), add a `tests/unit/<script-name>.spec.ts` pinning it — see `tests/unit/seed-subscriptions-config.spec.ts` for the pattern.
