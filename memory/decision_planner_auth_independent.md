# Decision · Planner auth is independent of SuiteFleet auth

**Status:** Decided. Captured from `aqib.a` review of `subscription-planner-onboarding_v1.1` page 6.
**Decision date:** 28 April 2026 (Day 3 EOD review).
**Decided by:** Love (engineering-owner).

## Source comment

> "I think we should not give them option to change the password, let them
> use suitefleet password only. But lets say if we have to give them option
> then this password should not update suitefleet password."

## Decision

The Subscription Planner has its own authentication system, independent of
SuiteFleet's. Merchants log into the Planner with Planner credentials.
Planner credentials are stored, rotated, and reset entirely within the
Planner — no sync, no propagation to SuiteFleet.

This is **option 2** of the three considered:

1. **Federated auth via SuiteFleet** — rejected. Couples Planner uptime to
   SuiteFleet auth uptime. Most Planner work (calendar, skip/append) does not
   need SuiteFleet at the moment of action; logging in shouldn't either.
2. **Separate password, separate store** — chosen. Planner uses Supabase
   Auth (already on the Day 5+ roadmap). Aqib's "don't update SuiteFleet
   password" condition is automatically satisfied — different stores, no sync.
3. **Same password, two stores** — rejected. Sync hell, drift, no win.

## What this means concretely

- Planner auth lands on Supabase Auth in the Day 5+ auth-wiring sprint.
- The Day-3 demo-context (`buildDemoContext`) is the temporary stand-in until
  Supabase Auth is wired (production-gated via `ALLOW_DEMO_AUTH=true` in
  Preview only, per PR #23).
- SuiteFleet credentials remain entirely in AWS Secrets Manager at
  `/transcorp/secrets/{tenant_id}/suitefleet/credentials`, used only by the
  `LastMileAdapter`. Merchants never see them. Resetting a SuiteFleet
  password (which Transcorp ops would do) does not affect the merchant's
  Planner login.

## Communication back to Aqib

When the auth-wiring sprint runs, surface this decision to Aqib's team. The
core message: "We agreed with your concern — separate stores, no sync. The
Planner login won't touch SuiteFleet credentials in either direction."
