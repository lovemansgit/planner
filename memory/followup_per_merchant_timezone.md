# Per-merchant timezone resolution — post-MVP lane

**Filed:** Day-53 (11 Jun 2026), Session A, per Love's Day-53 morning clearances ("approves filing a per-merchant timezone follow-up (post-MVP)"). T1 pointer memo — **scope at lane-open**, no design here.

## The premise

The product is Dubai-anchored throughout. Every time-of-day and date boundary assumes Asia/Dubai (permanent UTC+04:00, no DST):

- **Calendar + operator surfaces** render `tasks.delivery_start_time` / `delivery_end_time` as Dubai wall-clock.
- **18:00 cutoff** — `isCutOffElapsedForDate` enforces the 18:00-Dubai-day-before editability cutoff at ~10 service-layer sites (brief §3.1.8).
- **Materializer** computes the Dubai-local date for horizon math.
- **SF wire conversion** — `src/modules/integration/providers/suitefleet/tz.ts` and the outbound twin in `task-client.ts` hard-code the +4/−4 shift (deliberately, per the A3/A1 rulings: "not pulled from runtime TZ libs").

## Why it becomes wrong

KSA and Qatar merchants are UTC+3. The moment a production merchant is provisioned in `transcorp` (KSA) or `transcorpqatar`, every one of the anchors above is off by an hour for that merchant: windows render shifted, the cutoff fires an hour off the merchant's 18:00, the materializer's "today" can differ from the merchant's, and the fixed ±4 wire conversion is ±3 for them. The `suitefleet_regions` table (v1.14/v1.15) is the natural attachment point for a region- or merchant-level timezone, and `tenants` already resolves region per merchant — but WHERE the TZ lives (region vs tenant) and HOW the hard-coded shifts become resolved-per-merchant is exactly the lane-open scoping question.

## Posture

- **Post-MVP** (Love-ruled Day-53). MVP merchants are Dubai; the hard-coded +4 is correct for everything live today and for sandbox-first UAT.
- All four anchor families above must move together in one lane — converting the wire shift without the cutoff/materializer/display anchors would recreate the Day-52 §D class of bug (one path converted, its sibling not) at merchant granularity.
- Both TZs in play (GST +4, AST +3) are DST-free, so the "fixed shift, no runtime TZ lib" discipline can survive — as a per-merchant resolved offset rather than a constant — but that is a lane-open decision, not a commitment.

## Cross-references

- `memory/decision_d53_morning_clearances.md` — the filing authorization.
- PR #307 (outbound −4h) / Day-31 A1 `tz.ts` (+4h) / PR #365 (inbound edit-apply +4h) — the fixed-shift family.
- Brief §3.1.8 (cutoff), §3.6/§3.7 (regions + per-merchant credentials — the multi-region production path that makes this real).
