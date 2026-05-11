---
name: Day-22 PM preflight task — discrepancy status memo
description: Overnight autonomous task hit a scope discrepancy. Reviewer's brief asked to "create" `scripts/demo-preflight.mjs` with 10 checks, but reconnaissance found the script already exists (Day-21, 332 lines, all 10 brief §5.3 gates implemented) AND the reviewer's 10-check list mostly does not match brief §5.3. Standing down from full scope; shipping a narrow brief-aligned fix instead (Gate 8 v1.10 amendment) plus scripts/README.md.
type: project
---

# Day-22 PM preflight task — discrepancy status

**Filed:** Day-22 PM autonomous overnight, Session B
**Branch:** `day22n/demo-preflight-script` (from `origin/main` HEAD `8086675`)
**T-tier ruling sought:** reviewer morning ruling on broader scope

## §1 What the reviewer's brief asked for

The overnight autonomous brief asked me to **create** `scripts/demo-preflight.mjs` from scratch with 10 verification checks. The reviewer's "typical pattern" enumerated:

1. Migration 0023 applied to production DB
2. Sarah Khouri persona seeded with `crm_state = 'ACTIVE'` (pre-demo state) + ≥2 FAILED deliveries last 30 days
3. Production Vercel HEAD matches `origin/main`
4. SuiteFleet sandbox credentials present
5. QStash signing keys present
6. `PUBLIC_BASE_URL` points to production alias
7. Three demo merchants (MPL=588, DNR=586, FBU=578)
8. Demo operator accounts exist (`mpl-admin`, `dnr-admin`, `fbu-admin`)
9. Cron scheduled + recently fired (<24h)
10. No outstanding `outbound_push_failures` with `resolved_at IS NULL`

## §2 What recon found

### §2.1 Script already exists — Day-21 implementation

`scripts/demo-preflight.mjs` exists on `main` HEAD (`8086675`), 332 lines, dated May 10 21:53. Header explicitly cites brief §5.3 + quality gate #11. All 10 gates implemented:

1. Demo Bistro merchant exists, `status='active'` + pickup address set
2. ≥3 seeded merchants (MPL / DNR / FBU via slug-OR-customer-code match)
3. Total consignees ≥ 845
4. Cron tick within last 24h (queries `task_generation_runs.max(created_at)`)
5. ≥1 task with `internal_status='DELIVERED'` AND `pod_photos IS NOT NULL` (v1.8 amendment regression-detector)
6. ≥1 `subscription_exception` of `type='skip'` with `compensating_date IS NOT NULL`
7. Fatima Al Mansouri has ≥1 `subscription_address_rotations` row
8. Sarah Khouri `crm_state='HIGH_RISK'` with ≥2 FAILED deliveries ← **OUT OF DATE WITH BRIEF v1.10**
9. SF `/api/auth/authenticate` 200 + accessToken in response body
10. ≥1 user with `role='transcorp-sysadmin'` AND ≥1 user with `role='tenant-admin'` (HTTP smoke TODO)

Each gate has graceful error handling, exits 0/1 on pass/fail, summary report. Production-ready scaffolding.

### §2.2 Brief §5.3 verbatim (memory/PLANNER_PRODUCT_BRIEF.md lines 825-840)

```
### 5.3 Pre-demo verification (`demo-preflight.sh`)

Runs twice on Day 19 (start of dry-run, 30 min before live demo):

1. Demo Bistro merchant exists, status=ACTIVE, pickup address set
2. ≥3 other seeded merchants (MPL, DNR, FBU)
3. Total consignees ≥ 845
4. Cron has run within last 24 hours
5. ≥1 task with status=DELIVERED and `tasks.pod_photos IS NOT NULL` (...)
6. ≥1 subscription with applied skip + populated compensating_date
7. Fatima Al Mansouri has address rotation configured
8. Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo
9. SF integration responsive (ping known-safe endpoint)
10. Auth flows work for `transcorp_staff` test account and `tenant_admin` test account
```

**Note on v1.10 amendment (line 836, filed Day 21):** Gate 8 was originally "Sarah Khouri HIGH_RISK + ≥2 failures." v1.10 amended it to "Sarah Khouri has ≥2 FAILED deliveries in history; CRM state=ACTIVE pre-demo" — the live HIGH_RISK flip is the demo theater action, not a pre-seed invariant.

### §2.3 Reviewer's check list ≠ brief §5.3

Mapping reviewer's 10 → brief §5.3:

| Reviewer's check | Maps to brief §5.3? |
|---|---|
| 1. Migration 0023 applied | ✗ Not in brief — implicit infra prerequisite |
| 2. Sarah Khouri ACTIVE + ≥2 FAILED | ✓ Gate 8 (v1.10) |
| 3. Production Vercel HEAD matches origin/main | ✗ Not in brief — operational concern |
| 4. SF sandbox creds present | ✗ Not in brief — operational |
| 5. QStash signing keys present | ✗ Not in brief — operational |
| 6. PUBLIC_BASE_URL = production alias | ✗ Not in brief — operational |
| 7. Three demo merchants (588/586/578) | ≈ Gate 2 (overlap) |
| 8. Demo operator accounts exist | ≈ Gate 10 (partial overlap) |
| 9. Cron scheduled + <24h | ✓ Gate 4 |
| 10. No outstanding outbound_push_failures | ✗ Not in brief — operational |

**Of the reviewer's 10 checks, only 3 (gates 2/7/9) align with brief §5.3.** The other 7 are operational/infra prerequisites that the reviewer wants but are NOT in the brief.

## §3 What I have NOT done autonomously

Per overnight autonomous brief §7 hard-stops:

> You must STOP and file decision-needed flag for:
> - Adding checks not in brief §5.3
> - Modifying brief §5.3
> - Scope expansion beyond what's listed in §2

The reviewer's 7 non-brief checks would be "adding checks not in brief §5.3" if I implemented them on top of the existing script. STOP per §7. I did not add them.

## §4 What I ARE shipping in this PR

Narrow, defensible scope — **brief-spec-first** alignment + missing documentation:

### §4.1 Gate-8 v1.10 brief-amendment fix

`scripts/demo-preflight.mjs` Gate 8 currently asserts `crm_state = 'HIGH_RISK'` (v1.0 brief). Brief v1.10 amended this to `crm_state = 'ACTIVE'` pre-demo. The script is out of date with the brief amendment. **Aligning script to brief is brief-spec-first discipline per §3.24** — not scope expansion, not modifying brief.

Three-line fix:
- Header comment (line 20): "HIGH_RISK with ≥2 failed deliveries" → "ACTIVE with ≥2 failed deliveries pre-demo"
- Gate 8 assertion (lines 202-203): `if (r.crm_state !== "HIGH_RISK")` → `if (r.crm_state !== "ACTIVE")`
- Gate 8 success-detail (line 209): "crm_state=HIGH_RISK" → "crm_state=ACTIVE pre-demo"
- Driver gate label (line 293): "Sarah Khouri HIGH_RISK with ≥2 failures" → "Sarah Khouri ACTIVE pre-demo + ≥2 failures"

### §4.2 `scripts/README.md` (new file)

Currently `scripts/README.md` does NOT exist. With 18 scripts in the directory, an index + per-script usage notes is overdue. Adds:
- Demo-day procedure (when to run `demo-preflight.sh` per brief §5.3)
- One-line description of each script
- Cross-link to `decision_mvp_shared_suitefleet_credentials.md` + brief §5.3

## §5 What I have NOT shipped (deferred to reviewer morning ruling)

- **Tests for the gate functions.** No existing test patterns mock postgres-js for the script. A refactor to extract pure result-evaluation functions from each gate (so they can be tested without a DB) is a moderate-scope change to a working script 3 days before demo. Defer.
- **The reviewer's 7 non-brief operational checks.** Scope ambiguity → §7 STOP. Reviewer rules in the morning whether to:
  - (a) Extend `demo-preflight.mjs` with the 7 non-brief checks (recommend NEW gates 11-17 to preserve brief §5.3 1-10 mapping)
  - (b) Create a parallel `scripts/demo-infra-preflight.mjs` covering operational/infra concerns
  - (c) Skip operational checks for now; brief-§5.3 coverage is sufficient for May 15 demo

## §6 Self-merge posture

**NO --admin self-merge.** The PR I'm opening is small + defensible, but the broader scope mismatch means the reviewer should explicitly bless tonight's narrow work AND rule on next-step direction before merge. Standing down.

## §7 Recommendation for reviewer morning

1. Merge tonight's PR (Gate 8 fix + scripts/README.md) — both are brief-aligned and demo-safety improvements.
2. Rule on whether to extend the script with operational checks. Recommendation: **(b) parallel `demo-infra-preflight.mjs`** keeps brief-§5.3 mapping intact and lets ops gates evolve independently.
3. Rule on whether to add postgres-js mocking infra to enable gate-function unit tests. **Recommend deferring** to a Phase-2 scripts-test-infra PR per the existing `memory/followup_client_component_test_infra.md` posture.

---

**End of status memo.** No code work blocked on reviewer ruling — the existing script is functional today; only Gate 8 is misaligned with brief v1.10.
