# D56 Phase 8 — builder state handoff (resume point)

**Filed:** Day 56 (2026-06-21), T1 docs. For a fresh BUILDER session resuming Phase 8 (SF status renders distinctly). Builder-side facts; the reviewer holds its own.

Plan of record: `memory/plans/day-56-phase-8-status-distinct-render.md` (on main). Decision: `memory/decision_d56_phase8_status_distinct_render.md`. Brief: **v1.31** (§3.1.10 + §3.3.11).

---

## 1. CURRENT STATE — main HEAD `6cbdf96`

- **Lane 1 (#539) MERGED** to main (`6cbdf96`). Shipped: `CourierStatus` + `COURIER_STATUS_VALUES` (14 fine states, exact order/spelling) in `src/modules/integration/types.ts`, re-exported via the module index; `Task.courierStatus?: CourierStatus | null` read-model + repository `mapCourierStatus` defensive narrow (type-only `CourierStatus` import so the data layer never pulls the integration barrel's provider/db side effects); migration file `0035_tasks_courier_status.sql`.
- **Migration 0035 APPLIED + verified LIVE on production Supabase `qdotjmwqbyzldfuxphei`** (21 Jun 2026). On prod now: `tasks.courier_status text NULL` + `tasks_courier_status_check` (`courier_status IS NULL OR courier_status IN (`the 14 values`)`). **`tasks_internal_status_check` verified UNCHANGED** (still the 8 coarse values CREATED/ASSIGNED/IN_TRANSIT/DELIVERED/FAILED/CANCELED/ON_HOLD/SKIPPED). Preview = production = one instance, so prod is the only scope.
- **Route used:** `psql` over the `SUPABASE_DATABASE_URL` admin pooler connection (from `.env.local`; role `postgres`; host `aws-1-ap-south-1.pooler.supabase.com:6543` — the pooler, per the Nano IPv6-only rule). One file only, `ON_ERROR_STOP=1`.
- **SCOPE-LITERAL STOP — the pattern to repeat:** first apply attempt had `SUPABASE_DATABASE_URL` unset in the shell, so `psql` fell back to a **local socket** and reported `database "lovemans" does not exist`. That is a target mismatch (not `qdotjmwqbyzldfuxphei`) → I **STOPPED, did not apply**, located the correct pooler URL from the project env, and **verified the project ref via the connection username `postgres.qdotjmwqbyzldfuxphei` + `\conninfo` BEFORE applying**. Repeat this floor on every prod apply: confirm project-ref match first; any mismatch = stop-and-surface, never re-scope (the 0032–0034 breach is what re-scoping causes — `[[decision_d54_authorization_scope_literal]]`).

## 2. LANE 2 (#540) — built, PARKED, NOT merged

- PR **#540 OPEN**, base `main`, head `feat/d56-phase8-lane2-courier-status-mapper-applier` @ `16856ac`. **Worktree RETAINED** at `/private/tmp/planner-lane2-d56` (registered via `git worktree list`).
- Scope: the SF→fine mapper (`status-mapper` / `status-progression` fine maps) + `shouldAdvanceCourierStatus` in-transit ramp guard + the applier **dual-write** (writes both coarse `internal_status` and fine `courier_status`).
- **CourierStatus swap seam — LOAD-BEARING at merge-prep:** Lane 2 currently imports `CourierStatus` from a **LOCAL STUB** (`courier-status.ts` in the Lane-2 tree), created so Lane 2 could build before Lane 1 landed. **At merge-prep, swap the stub for Lane 1's canonical `@/modules/integration` export** (now on main) and delete the stub. The 14 values are byte-identical by construction, but the import path MUST become the canonical one or there are two sources of truth.
- **Merge-order (hard):** #540 must **rebase onto `6cbdf96`** (the Lane-1-bearing main) before merge. Its applier writes `courier_status`, which only exists post-0035 — so **integration CI is RED until #540 is rebased** onto Lane-1 main (the column/contract aren't present on its current base). Do not read a red integration job on #540 as a defect before the rebase.
- **Two design changes I made — real behavior changes, NOT tests bent to pass (reviewer should verify against the diff):**
  1. **Fine-guard subordinate to the coarse lifecycle lock.** `shouldAdvanceCourierStatus` advances the fine in-transit ramp (PICKED_UP < ARRIVED_AT_DC < IN_TRANSIT < HUB_TRANSFER < OUT_FOR_DELIVERY) **only within** what the coarse lifecycle permits. The coarse locks win: a HARD_TERMINAL coarse state (DELIVERED/CANCELED) or operator-set SKIPPED must still block any fine advance. WHY it's real: without subordination, a late SF webhook could advance `courier_status` on a task the coarse logic has already terminated/skipped — the fine field would tell a different story than the lifecycle. The guard is layered under the coarse `shouldAdvanceStatus`, not parallel to it.
  2. **`no_diff → applied: true` (was `false`).** The applier result for a no-op (inbound status maps to the same coarse+fine the task already holds) returns `applied: true`, not `false`. WHY it's real: a no-diff webhook is an **idempotent success** (the desired state already holds), not a failure or a skip — the dedup/retry path treats it as handled. The earlier `false` conflated "no change needed" with "did not apply," which would re-queue or mis-signal. The test was flipped because the *contract* changed, not to make a red test green.

## 3. LANES 3/4/5 (render fork) — NOT started

Per plan §10 + Love's cleared rulings (all on record, brief v1.31):
- **Fine-14 DROPDOWN filter on `/tasks` AND the calendar** (OQ-3 overruled — not coarse-7, not pills). URL-state via a new **`?courier_status=` param** — this is an **OPEN fork for Love at the Lane 3 code-PR** (`?courier_status=` vs repointing `?status=`); do not resolve it unilaterally.
- **Family-grouped legend** (OQ-4) — separate control from the dropdown filter; both stand.
- **6 new hand-rolled icons** (existing `*Icon.tsx` style): `PickupIcon`, `DcIcon`, `HubTransferIcon`, `OutForDeliveryIcon`, `ReturnIcon` (outline+solid variants), `RescheduleIcon`, `RetryIcon`. CANCELED stays null-glyph + strikethrough.
- **ASSIGNED → Ocean Blue** pill (was amber; Love accepted) — frees amber for the in-transit ramp.
- **Calendar unfold + mislabel fix** (`DayDisplayStatus`/`DAY_DISPLAY_VISUALS`): in-transit and out-for-delivery render as TWO distinct statuses (stop folding IN_TRANSIT→"Out for delivery"); ASSIGNED/CREATED/ON_HOLD stop collapsing into "Scheduled".
- **`ARRIVED_AT_DC` renders the label "Arrived in DC"** (Love's term; internal value unchanged).
- Amber ramp: OUT_FOR_DELIVERY = Signal Amber `#E8A33C` (brightest, locked); mid-journey demote down the ladder. Family colours only — no new hex (per §3.3.11). Per-state label+icon+colour table is plan §3.
- Surfaces to wire (9) + 3 shared maps: plan §6. Render reads `courier_status`, falls back to coarse `internalStatus` when NULL. Timeline drawer (#537) is now a normal coordinated surface.

## 4. PROD-MIGRATION APPLY — mechanism gap + the floor

- **No guardrailed prod-migration path exists** (`[[followup_migration_apply_runbook_gap]]`, `[[followup_prod_migration_mechanism_gap]]`): RUNBOOK §Database-migrations is an empty placeholder, no ledger of what's applied, no CI/deploy-hook, no Supabase-CLI link. Migrations apply **builder-over-pooler** (`psql` + `SUPABASE_DATABASE_URL`).
- The **auto-mode classifier BLOCKS the direct prod connection by default** (correct). It was **cleared via bypass mode** for the single 0035 apply (no settings edit needed that time; Love can also grant a `Bash(psql:*)` allow-rule).
- **Floor for every future prod apply:** Love names the **exact file + db**; builder verifies (file byte-identity vs reviewed SHA, project-ref match via `\conninfo`/username, target-not-already-applied) and **stops-and-surfaces on ANY mismatch — never re-scopes, never reasons "the spirit is safe"**. Apply the named file ONLY; if other unapplied migrations surface, report them, don't act. Never print a secret value (redact password in all output).

## 5. BUILD METHODOLOGY pointers (inherit these)

- **Three-role build methodology** (Builder / Reviewer / Owner; builder+reviewer always separate contexts; live-DB changes park for Love's sentence): `~/.claude/methodology/BUILD-METHODOLOGY.md` (read at session start when building/reviewing/planning).
- **T1/T2/T3 tiers + §3.6 review discipline:** brief **§7.1** (the §3.6 hard-stop checklist — plan compliance, test signal, **CI status (red blocks)**, architectural gates, brand discipline; builder reports CI in PR-open, reviewer verifies before clearing). Labels: `parked-t1/t2/t3`, `automerge-t1` (docs-lane reviewer-cleared auto-merge), `love-cleared` (off-allowlist clearance; auth = Love's recorded sentence). Gate Action: `.github/workflows/orch-automerge.yml`.
- **Shape-3 seam mechanics (learned this run):** verdict comment ON THREAD **before** the label; ORCH-CLEARANCE comment body must **start with the bare `ORCH-CLEARANCE` token** (a `## ` markdown heading makes the gate's `startswith` matcher miss it → spurious `parked-t3`). The verdict gate reads the **last** ORCH-VERDICT, so prior REQUEST_CHANGES rounds don't block once the latest is APPROVE at head. Reviewer subagents: dispatch **worktree-isolated, PR# only** (`[[reviewer_subagent_must_be_isolated]]`).

---

**Do next (reviewer's call, not the builder's to start):** unpark/rebase #540 onto `6cbdf96`, swap the CourierStatus stub for the canonical export, re-review. Lanes 3/4/5 scoped after. **No promote** (separate Love ruling, after all lanes ship).
