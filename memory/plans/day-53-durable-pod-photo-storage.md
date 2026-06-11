# Day-53 — durable POD photo storage: plan (PLAN-PR ONLY — the cost number parks for Love)

**Lane:** Plan-A wave, Lane A task 2. Direction ruled YES (`memory/decision_d53_plan_a_pre_uat_queue.md`); **the monthly cost number below is new recurring spend = Love-trigger #4 and needs Love's explicit conversational ruling (NOT firing-clearable). No code-PR until Love rules the number.**

## §1 The driver (grounded on the running product)

SF POD photos are S3 pre-signed links with a **7-day TTL**, minted ~1s before the DELIVERED webhook (Day-53 PM grounding). After 7 days the object is vendor-dead (S3 "Request has expired"; observed live on production rows). The Day-53 render-time proxy (`/api/tasks/[id]/pod/[index]`, #377) made within-TTL photos render and expired ones fail honestly (410) — **it cannot resurrect anything**. Durable = Planner captures the bytes within the TTL window and serves them forever.

Production volume today (read-only measurements, 2026-06-11):
- 55 DELIVERED tasks all-time; **28 carry PODs (51%) with 54 photos — 1.93 photos/delivery**.
- Real POD hosts: `s3.eu-central-1.amazonaws.com/reseource-tracking-transcorpsb/…` (the 2026-06-11 "POD" rows are seeded demo fixtures, `example.com` hosts — excluded).
- **Photo size is UNMEASURED** — every real POD is past TTL (403/404 server-side). Assumption: **1 MB/photo average** (typical driver-app JPEG; bounded 0.3–3 MB). The code-PR's first live capture logs actual sizes and this plan's math gets a one-line follow-up correction if reality is >2× off.

## §2 Volume model → the cost number

| Scale | Deliveries/mo | New photos/mo (×1.93 × 51%→100% POD-rate assumption: use 2/delivery) | New GB/mo | Cumulative yr-1 |
|---|---|---|---|---|
| Today (sandbox/demo) | ~115 | ~220 | ~0.2 GB | ~2.6 GB |
| First production merchant (~30 deliveries/day × 26 days) | ~780 | ~1,560 | ~1.6 GB | ~19 GB |
| 10 merchants at that size | ~7,800 | ~15,600 | ~16 GB | ~190 GB |

## §3 Storage choice + THE NUMBER (Love rules this)

**Chosen approach: Supabase Storage** (private bucket, same project) — already in the stack (DB, Vault), service-role access from the existing server-side code paths, zero new vendor/secret/account, and the existing POD proxy route becomes the single serving surface for both sources. Pricing verified 2026-06-11 ([supabase.com/pricing](https://supabase.com/pricing)):

- The project's **Free plan includes only 1 GB storage** — busted in the first month of one production merchant (§2).
- **The number: $25/month — Supabase Pro** (includes **100 GB storage + 250 GB egress**; overage $0.021/GB-mo). At §2's 10-merchant scale that holds ~6 months into year 1, then ~$2/mo per extra 100 GB. Egress headroom is enormous (operator viewing only).
- **If the project is already on Pro** (Love knows the org's plan; the builder cannot read it from here): **incremental cost ≈ $0/month** until 100 GB cumulative, then $0.021/GB-mo.
- **Cheaper alternative if a new vendor is acceptable: Cloudflare R2** — 10 GB free (≈ first year at single-merchant scale, $0/month), then $0.015/GB-mo with zero egress fees. Rejected as primary only because it adds an account + credential + SDK surface for savings of ≤$25/mo at MVP scale.

**The ruling Love owes:** approve **$25/month (Supabase Pro)** — or state the org is already Pro (→ $0 incremental, build proceeds on the same design) — or redirect to R2 ($0/mo, new vendor).

## §4 Build shape (code-PR, AFTER the ruling)

1. **Capture is queue-decoupled, forward-only.** On DELIVERED webhook apply (where `pod_photos` lands today), enqueue ONE capture job per task (`/api/queue/capture-pod`, QStash, same publisher conventions: dedup `${task_id}_podcapture_${event ts}`, retries 3, failure callback → DLQ row `operation='pod_capture'`). The consumer server-fetches each pre-signed URL (fresh — minted seconds earlier), streams to the private bucket at `pod-photos/{tenantId}/{taskId}/{index}.jpg`, records captured paths. Webhook latency unchanged.
2. **Schema:** one nullable jsonb column `tasks.pod_photo_captures` (array of bucket paths, index-aligned with `pod_photos`) — **migration PARKS with SQL-TO-APPLY** per standing rules. Original SF URLs stay untouched (forensics).
3. **Serving:** the existing proxy route prefers the captured object (service-role read from the private bucket, streamed through the proxy), falls back to the SF URL within TTL, 410 only when neither exists. The browser-facing contract (#377) is unchanged.
4. **Backfill: none possible.** All currently-expired PODs are vendor-dead; capture starts at deploy. Stated to ops in the PR.
5. **Retention:** indefinite at the §3 number. A retention policy (e.g., purge after 12/24 months) is a future Love-call lever to flatten the curve, not designed here.
6. Tests RED-first: capture consumer happy path (real Postgres + storage mock at the boundary), DLQ on fetch failure, proxy preference order, index alignment, TTL-expired fallback honesty.

## §5 Scope fences

- Plan-PR only; **no code, no migration, no bucket creation, nothing billable happens from this PR.**
- DO-NOT-TOUCH honored (no /tasks surfaces, no addresses, no Session C files).
- Deferred follow-ons from the Day-53 POD lane (admin POD cell variant, orphaned CalendarPodCard cleanup) stay deferred — not folded in.
