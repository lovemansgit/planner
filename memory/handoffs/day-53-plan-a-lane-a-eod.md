# Day-53 PM — Plan-A wave, Lane A (Session A) EOD

**Date:** 2026-06-11. **Dispatch:** R16 resume re-sync + durable-photo-storage plan. Session A is EOD owner today.

## 1. R16 — built end-to-end, both PRs parked

- **Probes first** (spec mandate; five Demo Bistro probe tasks, all left CANCELED): SF **cancel is terminal** via the API client (`{status:"ORDERED"}` un-cancel PATCH → 403 "User not allowed to do such action") → re-activation = **re-create**. Second probe: a fresh create reusing the SAME `customerOrderNumber` against a CANCELED task → **200, new AWB** — the push pipeline's AWB-exists reconcile trap does not fire. Forensic trail in `webhook_events` (tenant `29502ac3-…`, 11:56–12:06Z).
- **Plan #408** (parked-t3, APPROVE r1) → **code #410** (parked-t3, **APPROVE r2**, CI green at `241606e`): restore clears external ids + flips SF-cancelled rows to `pending`; `enqueueTaskPushBatch` re-enters them into the existing push pipeline (fresh SF create, new AWB); new `subscription.resume_reactivations_pushed` event with `previous_awbs` forensics; emit-then-re-throw R2 posture. **Bonus fix pinned RED-first: late old-AWB webhooks can no longer clobber a restored task back to CANCELED.** Zero migrations (dispatch expectation held).
- Brief **v1.22** + §3.1.2 line ride #410; **UAT run-sheet step-H limitation note retired** (recorded follow-through closed).
- Residual ghost-cancel race (in-flight cancel meets resume): VISIBLE (Sentry + previous_awbs + DLQ), deferred to the five-race triage per Love's sequencing.

## 2. Durable POD photo storage — plan parked with THE NUMBER

**#413** (needs-directional-ruling, APPROVE r1). The ruling that is Love's, one line: **approve $25/month (Supabase Pro, 100 GB)** — or state the org is already Pro (→ ~$0 incremental) — or pick **Cloudflare R2 ($0/month, new vendor)**. Grounding: 28/55 delivered tasks carry PODs (1.93 photos avg, size assumed 1 MB — all real PODs past TTL); first production merchant ≈ 1.6 GB/month new → the free plan's 1 GB busts in month one; capture is forward-only, so every week unruled loses that week's PODs permanently. Build shape (post-ruling code-PR): queue-decoupled capture on the DELIVERED webhook, one parked migration (`pod_photo_captures`), proxy serves captured-first.

## 3. Brief-version coordination (three bumps in flight)

#405 and #412 both carry **v1.21**; my #410 carries **v1.22**. Landing order decides: whichever of #405/#412 clears second renumbers; #410's v1.22 assumes one of them lands first — if #410 merges first, it renumbers to v1.21 (one-line fixups, all flagged in the ORCH-PARKs).

## 4. Queue at EOD (7)

#413 (POD cost number — conversational), #409 + #412 (Session C R12 pair), #405 (Session C add-address, awaiting v1.21 confirm line), #411 (runbook — needs Love's manual merge, builder-side permission gate), #410 + #408 (R16 pair). Morning-after Demo Bistro state: live on api_key, wire proven, Q4 closed (see `decision_d53_demo_bistro_apikey_wire_evidence.md`).
