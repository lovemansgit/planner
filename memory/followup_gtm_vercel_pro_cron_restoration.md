---
name: GTM precondition — Vercel Pro (permanent) + auto-resume cron */15 restoration
description: Love's Day-54 ruling — the Day-54 Vercel Pro upgrade is BUILD-WINDOW spend only (downgrades to Hobby when the build completes); the auto-resume cron stays at the Hobby-safe daily 11:00 UTC. PERMANENT Vercel Pro + the */15 cron restoration are recorded GTM preconditions, alongside Supabase Pro + production SF credentials.
type: followup
---

# GTM precondition — Vercel Pro (permanent) + */15 cron restoration (recorded Day-54)

**Love's ruling (Day-54, 2026-06-12, counter-amendment, paraphrased on the record):**
Vercel Pro is TEMPORARY — for the build window only; Love downgrades to Hobby
when the build completes. The daily-11:00-UTC auto-resume cron is the
Hobby-safe setting and STAYS until Love says otherwise. The permanent */15
restoration moves to the GTM preconditions.

## What this means operationally

- **Now:** `vercel.json` keeps `0 11 * * *` for `/api/cron/auto-resume` (the
  Day-51 degradation, brief v1.17 operational note). Auto-resume latency stays
  up-to-24h; the 11:00 UTC slot still beats the 12:00 UTC materializer, so no
  delivery-day miss for D-day pause-end dates. Do NOT restore `*/15` on
  sighting a Pro plan — Pro presence is not the trigger; **Love's sentence is.**
- **Before the FIRST production merchant onboards**, alongside the existing
  preconditions (Supabase Pro $25/mo + production SF credentials —
  `memory/followup_gtm_supabase_pro_upgrade.md`):
  1. **Vercel Pro active PERMANENTLY** ($20/mo) — restores deploy headroom
     (the free 100/day cap blocked two promotes and a redeploy on Day-54) and
     sub-daily crons.
  2. **`*/15 * * * *` restored** on `/api/cron/auto-resume` in `vercel.json`
     (the v1.17 note's reversion path) — one-line PR + the next deploy carries
     it.
- **Owner:** Love (billing); the cron line is builder-executed on his sentence.

## Cross-references

- `memory/followup_gtm_supabase_pro_upgrade.md` — the sibling precondition memo.
- Brief §9, Day-51 operational amendment (auto-resume cron degradation + reversion path).
- `memory/followup_vercel_auto_promote_main_to_production.md` — adjacent Vercel-plan history.
