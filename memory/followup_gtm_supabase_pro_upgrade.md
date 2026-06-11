---
name: GTM precondition — Supabase Pro upgrade before first production merchant
description: Love's Day-53 EVE ruling converted the POD-storage $25/mo spend ask into a recorded go-to-market precondition — Supabase Pro must be ACTIVE before the first production merchant onboards, alongside production SF credentials. Photo capture builds on the free tier now (1 GB cap, log-and-alert guardrail).
type: followup
---

# GTM precondition — Supabase Pro upgrade (recorded Day-53 EVE)

**Love's ruling (verbatim, 2026-06-11):**

> "Love rules, 2026-06-11: photo storage builds NOW on the existing Supabase free tier — no spend, no new vendor. Supabase Pro upgrade is a recorded GO-TO-MARKET PRECONDITION: active before the first production merchant onboards, alongside production SF credentials. #413 cleared on this basis."

## What this means operationally

- **Now:** POD photo capture (plan `memory/plans/day-53-durable-pod-photo-storage.md`, #413 merged `bb9e814`) runs on the **free tier's 1 GB storage cap**. The build carries a log-and-alert guardrail as usage approaches the cap — never a silent drop. Sandbox/demo volume (~0.2 GB/month) fits comfortably.
- **Before the FIRST production merchant onboards** (the same gate as production SF credential entry — see [[apikey-probe-gate-open]] / `decision_d53_demo_bistro_apikey_wire_evidence.md` standing state):
  1. **Supabase Pro upgrade ($25/month) must be ACTIVE** — production POD volume (~1.6 GB/month at one merchant) busts the free cap in month one, and capture is forward-only: photos not captured within SF's 7-day TTL are lost permanently.
  2. Production SF credentials entered by Love/Aqib via the admin screen (standing flag, unchanged).
- **Owner:** Love (billing action in the Supabase dashboard — builders cannot do this). Surface this memo in any go-to-market / first-production-merchant checklist.

## Cross-references

- `memory/plans/day-53-durable-pod-photo-storage.md` §3 — the cost model behind the number.
- `memory/decision_d53_plan_a_pre_uat_queue.md` — the Plan-A ruling that directed the plan.
- Production-SF-credentials standing flag — the sibling precondition this rides alongside.
