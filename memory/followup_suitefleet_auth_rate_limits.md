---
name: SuiteFleet auth-side rate limits + lockout policy undocumented
description: SuiteFleet's auth endpoint rate-limit policy and account-lockout behaviour are not documented. The S-7 token cache implements concurrent-request dedup to make repeat-arriver scenarios produce a single login, but the auth rate-limit ceiling itself is unknown.
type: project
---

The S-7 token cache (`src/modules/integration/providers/suitefleet/token-cache.ts`) implements concurrent-request deduplication: 100 simultaneous `getSession` calls for the same tenant produce one login attempt, not 100. This protects against thundering-herd scenarios at the 16:00 cutoff and across general parallel work.

What the dedup does NOT protect against — and what we don't know:

1. **SuiteFleet auth endpoint rate limits.** The conservative 5 req/sec figure in `memory/decision_daily_cutoff_and_throughput.md` covers `createTask`. SuiteFleet's auth endpoints (`POST /api/auth/authenticate`, `GET /api/auth/refresh`) may have separate, undocumented limits. Multiple tenants logging in simultaneously (e.g. 3 pilot merchants × 1 cron each at the same minute) bypass our same-tenant dedup and could trip a per-account or per-IP cap.

2. **Account-lockout policy on repeated 401s.** If credentials rotate or get briefly desynced (Secrets Manager swap on Day 5+, ops typo, etc.), the auth client retries up to 3 times on 5xx but does NOT retry on 401. Repeated 401s within a short window from the same SuiteFleet user could trigger an account lockout — silently breaking integration until manually unlocked.

3. **Sandbox vs production parity.** Sandbox limits are typically more permissive than production. If we're testing happy-path scenarios in sandbox during S-9 and proceeding to production with the same retry/dedup parameters, we may get a surprise on first heavy-traffic day.

**How to apply:** Email SuiteFleet account manager pre-Day-14 (folded into the existing pre-Day-14 communication that already covers webhook retry policy + error-code catalogue). Confirm:

- Per-tenant and per-IP rate-limit ceilings on the auth endpoints (specifically `/api/auth/authenticate` and `/api/auth/refresh`).
- Account-lockout policy: how many failed logins (401s) within what window, and what's the unlock procedure.
- Whether sandbox and production share the same auth-side limits or differ.

If production limits are tighter than expected, the dedup map in S-7 may need to extend to **cross-tenant** dedup with a small jitter (stagger logins across tenants by ~100ms) at startup or post-deploy moments when many tenants want a fresh session at once. Day-5 Redis swap is the natural moment to add cross-tenant pacing.

**Surfaced:** Day 4 / S-7 PR review (29 April 2026) when concurrent-request dedup was added to the in-memory cache.
