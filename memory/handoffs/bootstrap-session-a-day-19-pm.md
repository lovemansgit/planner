# Session A bootstrap brief — Day-19 PM continuation

**For:** fresh Session A successor at Day-19 PM compact resume
**Filed:** Day 19 (9 May 2026), late afternoon, post backend-lane-complete signal on the Phase 1.5 admin cross-tenant code-PR
**Filed by:** outgoing Session A at ~36% memory; bootstrap brief itself drafted before compact at ~14-19% projected

---

## §1 Handoff context

Session A delivered the BACKEND lane of the Phase 1.5 Transcorp admin cross-tenant code-PR (per merged plan-PR #211). Six commits pushed; verification clean. PR is **NOT yet open** because the UI lane (Session B's domain) goes on top of the same shared branch first; the combined PR opens after Session B completes.

Outgoing Session A signaled "backend complete + tests green" with HEAD SHA `058f79c` for Session B's trigger condition. Bootstrap brief filed before compact to preserve cross-section context that wouldn't survive a cold-read (plan-PR amendment wording, body-read findings, OQ resolutions, do-not-do guardrails).

---

## §2 Branch state at handoff

- **Branch:** `day19/phase-1-5-admin-cross-tenant-code`
- **HEAD SHA at handoff:** `058f79ccf7cd674ed7028213e24202ac06f7b800`
- **Branched from:** `29931c1` (= `origin/main` post merged plan-PR #211 — Phase 1.5 plan + brief v1.8 → v1.9)
- **PR open?** NO — Session B's UI lane goes on top first; combined PR opens after Session B completes
- **Local cleanup state:** Session A's worktree is on detached HEAD because Session B holds `main` checkout in `~/work/planner-b`. Detach is harmless for read-only / new-branch work

### Session A's 6-commit ledger on the shared branch

| # | SHA | Type | Notes |
|---|---|---|---|
| 1 | `9498ff7` | feat(perms-d19) | 3 new perms registered + 3 in `API_KEY_FORBIDDEN_PERMISSIONS` |
| 2 | `4453c11` | feat(services-d19) | `listAllTasks` / `listAllConsignees` / `listAllSubscriptions` + types |
| 3 | `f290fc1` | feat(repos-d19) | `listAll<X>Rows` JOIN tenants extensions (3 fns) |
| 4 | `8a982a0` | test(integration-d19) | 3 NEW spec files (admin-tasks/consignees/subscriptions-cross-tenant); 21 tests green |
| 5 | `e4a2eb0` | memo(d19) | `followup_phase_1_5_search_affordance_phase_2.md` + MEMORY.md index |
| 6 | `058f79c` | fix(roles-d19) | `permsFor()` filters systemOnly — closes invariant test gap surfaced by Commit 1 |

### Verification passed at handoff

- ✅ `npm run typecheck` clean
- ✅ `npm run lint` 7 pre-existing warnings (zero net-new; matches Day-18 EOD §1 baseline)
- ✅ `npm test` (unit) — 1262/1262 green
- ✅ 3 admin cross-tenant integration specs — 21/21 green

---

## §3 Plan §3.6 amendments + reviewer rulings still load-bearing

**Verbatim — for next-Session-A integrity. DO NOT relitigate.**

### §3.6 amendment to permission descriptions (load-bearing wording)

The 3 new permission entries use this wording:

> "Granted only to transcorp-sysadmin; tenant operators see only their own tenant's data via `<resource>:read` (single-tenant scope)."

This is the §3.6-AMENDED text. The pre-amendment draft used "tenant operators MUST use `<resource>:read`" — that wording was explicitly REPLACED pre-merge per reviewer's verdict ("phrasing should describe system behavior, not prescribe operator action"). Force-push-with-lease was used to land the amendments.

**DO NOT regress this wording back to "MUST use" if redrafting.** Both shapes appear equivalent; the amended one is the canonical wording.

### §3.6 amendment to plan §5

A single sentence was added between the Index-usage bullets and the "No index additions in this PR" line:

> "OFFSET pagination acceptable at pilot volume; cursor pagination is Phase 2 candidate if cross-tenant tasks scale to 10k+ rows."

This sentence is captured in the merged plan §5 and informs the followup memo's Lane B (cursor pagination).

### Open-question rulings (from §3.6 final ack)

| OQ | Topic | Reviewer ruling |
|---|---|---|
| OQ-1 | Brief §2.3 amendment text | Approved as written (two-workflow framing) |
| OQ-2 | Permission descriptions exact wording | Approved with the 3 wording amendments above |
| OQ-3 | Filter on unknown merchant slug — error contract | `ValidationError` + page surfaces inline + falls back to no-filter view; **exact error string left to code-PR time** |
| OQ-4 | JOIN columns scope | `tenants.id, slug, name, status` — **no extension to `customer_code` etc.** |

---

## §4 Pending work owed to next Session A

In order of expected sequencing:

1. **React to §3.6 counter-review on COMBINED backend+UI diff** after Session B opens the PR. Reviewer will body-read the merged diff and surface concerns — typical T3 hard-stop-twice pattern (PR #211 plan + this code-PR each get their own §3.6 review).
2. **Apply any pre-merge amendments** the reviewer requests (force-push-with-lease only with explicit reviewer pre-authorization per `memory/feedback_force_push_requires_pre_authorization.md`).
3. **Merge after reviewer approval** via `gh pr merge <#> --squash --delete-branch`.
4. **Vercel preview verification** post-merge (no migration; runtime-only — admin pages render under bom1 region).
5. **Stand by for next-batched-promote prompt** — Phase 1.5 lands on prod via the next cadenced Vercel promote (likely Day-20 morning batched promote per established one-promote-per-day cadence).

---

## §5 Session B carry-forward state

Session B has the trigger SHA (`058f79c`) and is expected to:
1. Pull `origin/day19/phase-1-5-admin-cross-tenant-code`
2. Add UI commits on top:
   - 3 NEW admin pages: `(admin)/admin/tasks/page.tsx`, `(admin)/admin/consignees/page.tsx`, `(admin)/admin/subscriptions/page.tsx`
   - Shared `MerchantFilterDropdown` at `(admin)/_components/MerchantFilterDropdown.tsx`
   - `nav-config.ts` `ADMIN_NAV_ITEMS` += 3 entries (Tasks, Consignees, Subscriptions)
3. Surface to reviewer when UI-complete; reviewer relays back to Session A for combined §3.6 review

### Session B body-read awareness items

- **POD column inclusion question** — `AdminTaskRow.task` includes `pod_photos` (mapped via existing `mapTask` + `mapPodPhotos`). Session B should surface to reviewer whether `/admin/tasks` should render a POD-photo indicator column (mirrors `/tasks` operator-side bag-icon column from Day-18 §3.8). If yes: design call. If no: don't render the column.
- **Pre-PR verification gates** Session B should run before opening PR:
  - `npm run typecheck` clean
  - `npm run lint` zero net-new (baseline = 7 pre-existing warnings)
  - `npm test` full unit suite green (current count 1262)
  - Local Vercel preview navigation through the 3 new admin pages with a transcorp-sysadmin login

---

## §6 Backend public surface delivered (verbatim signatures)

```ts
// src/modules/tasks/service.ts
export async function listAllTasks(
  ctx: RequestContext,
  filters: ListAllTasksFilters = {},
): Promise<readonly AdminTaskRow[]>;

// ListAllTasksFilters re-exported from tasks/repository.ts:
//   { merchantSlug?: string, limit?: number, offset?: number, status?: TaskInternalStatus }
// AdminTaskRow:
//   { task: Task, merchant: { tenantId: Uuid, slug: string, name: string, status: TenantStatus } }


// src/modules/consignees/service.ts
export async function listAllConsignees(
  ctx: RequestContext,
  filters: ListAllConsigneesFilters = {},
): Promise<readonly AdminConsigneeRow[]>;

// ListAllConsigneesFilters: { merchantSlug?: string, limit?: number, offset?: number }
// AdminConsigneeRow:
//   { consignee: Consignee, merchant: { tenantId, slug, name, status } }


// src/modules/subscriptions/service.ts
export async function listAllSubscriptions(
  ctx: RequestContext,
  filters: ListAllSubscriptionsFilters = {},
): Promise<readonly AdminSubscriptionRow[]>;

// ListAllSubscriptionsFilters: { merchantSlug?: string, limit?: number, offset?: number }
// AdminSubscriptionRow:
//   { subscription: Subscription, merchant: { tenantId, slug, name, status } }
```

**Filter validation:** Each fn pre-flights `merchantSlug` via `SELECT 1 FROM tenants WHERE slug = $slug LIMIT 1` inside the `withServiceRole` block. Unknown slug → `ValidationError("merchantSlug filter does not resolve to an existing tenant: <slug>")`.

**Pagination defaults:** `limit ?? 50`, capped via `Math.min(..., 500)`. `offset ?? 0`. Operator-side parity per merged plan scope item 8.

**Default sort:**
- Tasks: `ORDER BY t.delivery_date DESC, t.created_at DESC`
- Consignees: `ORDER BY c.created_at DESC`
- Subscriptions: `ORDER BY s.created_at DESC`

---

## §7 Body-read findings to carry into next Session A's reviewer-discipline awareness

Three body-read catches happened across Day-19 — pattern emerging that §3.6 reviews must extend BEYOND the changing surface to helper functions and consumers that depend on the surface.

| # | Day-19 body-read catch | Where the §3.6 review missed it |
|---|---|---|
| 1 | T3 webhook handler lookup-column smoke pre-fire (PR #210) — handler queried `external_id`; production stores AWB in `external_tracking_number`. Test fixtures matched broken pattern. | §3.6 review of the A2 plan-PR (#199) didn't body-read the production data layout vs handler lookup column. |
| 2 | Commit 6 of this code-PR — `permsFor()` helper inadvertently captured new systemOnly perms because it returned ALL perms for a resource. Plan §3 had said "Roles delta: ZERO" — true for the explicit role table, but `permsFor` was a helper consumer. | §3.6 review of plan PR #211 catalogue-diff didn't body-read helper-function consumption. |
| 3 | Day-19 spike for the dedup bug (PR #208) — memo originally attributed wrap to `postgres.js sql.begin()`; spike showed it's actually `drizzle-orm pg-core/session.js queryWithCache`. | First-pass memo wasn't body-read against the actual stack trace shape. |

**Lesson for next Session A:** when the reviewer's §3.6 counter-review surfaces a body-read concern, check helper functions and downstream consumers, not just the changing surface. Specifically for the Phase 1.5 combined PR: §3.6 review should body-read:
- Page-level `try/catch` patterns (Forbidden / NotFound / NoTenantConfigured branches)
- `MerchantFilterDropdown` URL-state wiring (push vs replace; SSR initial value extraction)
- Any new test-fixture pattern in case the convention drifts (esp. multi-tenant seed shape)

---

## §8 Day-19 PM remaining work after Phase 1.5 ships

Sequencing (dependent on Phase 1.5 code-PR merging):

1. **Phase 1.5 code-PR merge** — combined backend (Session A) + UI (Session B). Then Vercel preview verification. Then next-batched-promote.
2. **EOD doc drafting** — `memory/handoffs/day-19-eod.md`. Canonical day-close artifact. Draft after Phase 1.5 lands; should reference plan PR #211 + code-PR # + 4 prior PRs (#208/#209/#210/#211 already merged today).
3. **Slipped lanes (carry to Day-20):**
   - Brand pass on per-page surfaces
   - `demo-preflight.sh` script
   - Demo data prep for Fatima Al Mansouri + Sarah Khouri personas (PR #209 seeded the framework; finishing touches outstanding)
4. **Dropped per Love** (do NOT pursue):
   - SF sandbox cleanup with Aqib for the Day-18 Gate-18 task (`MPL-14794527`) — Love accepted the soft-archive state (`internal_status='CANCELED'` on Day 18, then flipped to `'DELIVERED'` during Fire 1 of A2 smoke; left as-is)

---

## §9 What NOT to do (next Session A integrity)

- ❌ Do NOT relitigate plan §3.6 amendments. They are merged and canonical on `main` at SHA `29931c1` (brief v1.9). The "see only their own tenant's data via" wording is the canonical permission description.
- ❌ Do NOT drop the "see only their own tenant's data via" wording back to "MUST use" if redrafting permission descriptions for any reason.
- ❌ Do NOT attempt to merge the code-PR before Session B's UI lane lands AND combined §3.6 counter-review completes. The single shared-branch pattern means premature merge breaks Session B's expected workflow.
- ❌ Do NOT claim §3.6 counter-review is "approved" — that's the reviewer's call, not the session's. Surface the readiness signal, then wait.
- ❌ Do NOT use `git push --force-with-lease` without explicit reviewer pre-authorization per `memory/feedback_force_push_requires_pre_authorization.md`. Surface → authorize → act.
- ❌ Do NOT auto-promote to Vercel production without explicit reviewer instruction — one-promote-per-day cadence (twice broken today; Day-20 cadence resets).

---

## §10 Files to read on Session A spawn (post-compact)

In order:

1. `PROJECT-INSTRUCTIONS.md` (CLAUDE.md / global)
2. `memory/PLANNER_PRODUCT_BRIEF.md` (now v1.9)
3. `memory/handoffs/day-18-eod.md` (last canonical EOD doc — Day-19 EOD not yet filed)
4. `memory/MEMORY.md` (index — current through Day-19 entries)
5. **`memory/handoffs/bootstrap-session-a-day-19-pm.md`** (THIS BRIEF — Day-19 PM continuation)
6. `memory/followup_webhook_handler_status_pod_date_sync_bug.md` (still load-bearing per Reviewer D's ruling, though A2 smoke PASSED today — flag for closure when reviewer chooses; DO NOT close autonomously)

After absorbing, surface readiness with:
- Verified branch state (`gh pr view <code-PR-#> --json state,mergeable,statusCheckRollup` once PR is open)
- Verified `origin/main` SHA
- Carry-forward enumeration (§4 + §5 + §8 above)
- Stand by for §3.6 counter-review prompt from reviewer

---

**End of bootstrap brief.**

Total read time projected ≈ 6-8 minutes for a cold session. Carry-forward integrity preserved through compact.
