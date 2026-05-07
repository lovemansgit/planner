---
name: Day-17 mid-session pre-compact bootstrap
description: Standing 10% context-budget bootstrap doc. Captures Day-17 morning + afternoon PR ledger, production lag state, sequence position, active discipline rules, and explicit pickup pointer for post-compaction continuity.
type: project
---

# Day-17 mid-session pre-compact bootstrap

**Filed:** Day 17 (7 May 2026), mid-day, during T2 hotfix work for the drizzle array-binding bug.

---

## §1 Today's PR ledger (in chronological order)

| # | PR | Tier | Merge SHA | Delivered |
|---|---|---|---|---|
| 1 | #162 | T1 | `c31b4fb` | Day-16 plan-sync bundle (5 net-new memos + 14-item Day-16 index backfill in MEMORY.md) |
| 2 | #163 | T1 | `ed61f35` | Day-17 CRM state UI plan v1.0 — 10 sections, 512 lines; locked Drift #1 Option A (build /consignees/[id]) + Drift #2 Option B (server actions, no TanStack) |
| 3 | #164 | T1 | `5cb6e34` | Brief v1.4 amendment — §3.3.11 rewritten in full (palette + composition + typography + scale + typesetting + fallback stack + logo + state-semantic colors) |
| 4 | #165 | T1 | `8b5074b` | Logo asset commit — 882KB PNG (3840×3840 RGBA); deleted old transcorp-logo-full.jpeg + transcorp-logo-white.png |
| 5 | #166 | T1 | `53ab411` | Brand tokens + Manrope load — `src/app/layout.tsx` Manrope import, Mulish weight 800, Sanchez italic; brand-tokens.css extended with amber ladder, neutrals, type scale; tailwind.config.ts extended |
| 6 | #167 | T1 | `69bad24` | CRM plan v1.0 → v1.1 amendment — §3.1 visual treatment table now references brief v1.4 §3.3.11 state-semantic colors directly |
| 7 | #169 | T1 | `fa6ad1e` | Brief v1.5 + token color canon — Navy `#0F2A5C` → `#252d60`; Green `#2E8B4A` → `#3e7c4b` (matches corporate SVG fill values) |
| 8 | #168 | T2 | `f22cb93` | T2 #1 app-shell brand pass — logo lockup + UserMenu + request-context extension + visual refinement (logo 64×64 → SVG; green go-signal accents); 3 squashed commits; first React client component (UserMenu); helper-only test coverage with full interaction tests deferred |

**This hotfix PR** (in flight, not yet merged): drizzle array-binding bug fix in `listVisibleTaskIds` + `tenant-admin-invariant` + Pattern E sql-helpers doc + integration tests. Branch `day17/listvisibletaskids-array-binding-hotfix`. T2.

PR #126 stale Day-11 EOD memo also closed today (no merge; content already on main via direct commit `a5743c8`).

---

## §2 Production lag state

**Current main HEAD:** `f22cb93` (PR #168 T2 #1 app-shell brand pass).

**Production deployment (`planner-olive-sigma.vercel.app` alias):** `dpl_EEJtUU9NVjSKZk1p6RF1sjAfpSUc` from Day-16 EOD per Day-16 EOD §4.1. **Has NOT been promoted since Day 16.**

**Production lag = 8 commits unpromoted:**
1. `4f690b0` — Day-16 EOD doc (memory-only)
2. `c31b4fb` — Day-16 plan-sync bundle (memory-only)
3. `ed61f35` — Day-17 CRM plan v1.0 (memory-only)
4. `5cb6e34` — Brief v1.4 amendment (memory-only)
5. `8b5074b` — Logo asset (un-rendered until app-shell consumer)
6. `53ab411` — Brand tokens + Manrope (consumed but not visible until UI surfaces use them)
7. `69bad24` — CRM plan v1.1 (memory-only)
8. `fa6ad1e` — Brief v1.5 + token canon (renders new hex when consumed)
9. `f22cb93` — T2 #1 app-shell brand pass (FIRST commit with visible production behavior change — logo, UserMenu, etc.)

This hotfix PR (when merged) becomes the 10th in the lag.

**Promotion-trigger discipline:** the 500-bug-fix hotfix is potentially production-critical for the L4 plan PR's smoke test viability. Love rules on whether to promote-after-hotfix-merge or batch with later Day-17 work.

---

## §3 Day-17 sequence — done / in flight / next

**Done (morning + afternoon batch):**
- All T1 foundation work (plan-sync, plans, brief amendments, logo, brand tokens) — 7 PRs merged
- T2 #1 app-shell brand pass + UserMenu (the codebase's first React client component) — PR #168 merged after rebase + 3-commit refinement
- Brief v1.4 → v1.5 (color hex reconciliation to corporate SVG asset) — PR #169 merged
- Stale Day-11 PR #126 closed without merge

**In flight (this turn):**
- **T2 hotfix PR for drizzle array-binding bug.** Branch `day17/listvisibletaskids-array-binding-hotfix`. Code edits applied, integration tests passing locally (11/11), full local verification clean (lint + tsc + 1191/1191 unit). Pending: commit + push + open PR (Step 8-9 of the workstream).
- The bug surfaced via Day-17 production smoke (Love clicked Print labels on the PR #168 preview, hit HTTP 500). Root cause is drizzle/postgres-js JS-array template-tag splatting that fails to cast to `uuid[]`.

**Next (after hotfix merges + Love re-smoke-tests):**
- **L4 plan PR drafting (Day-17 substantive #2)** — Transcorp logo swap on the SF-returned label PDF. Currently blocked on the smoke test working. Pre-flight discovery already done: SF endpoint contract fully known per `memory/followup_suitefleet_label_endpoint.md`; the unknown is SF's logo placement on the returned PDF, requiring a sample fetch.
- Day-17 substantive #1 implementation (CRM state UI per the merged plan PR #163 + #167) — composes against the brand-passed shell from PR #168. Detail page scaffolding + list badge column + transition modal with server actions + History tab + new `getConsigneeCrmHistory` service fn.
- Day-17 substantive #3 + #4: address change workflows + per-task delivery timeline + consignee timeline view (per brief §6 Day-17 slot).

---

## §4 Active discipline rules

### §A REGISTERED-METADATA-WINS (since Day-16 Block 4-D)

Registered `metadataNotes` at `src/modules/audit/event-types.ts` is the contract for audit body shape; plan-text and reviewer rulings subordinate when conflicting with already-shipped registered contracts. STOP and surface when reviewer drafting drifts from registered/shipped state.

### Drizzle array-splat pattern — **THIRD occurrence today (NEW pattern: Pattern E)**

The same drizzle/postgres-js JS-array template-tag splat bug has fired three times now:
1. PR #153 cron-decoupling (Day 14, in-flight CI fix)
2. `listVisibleTaskIds` (Day 8 ship, Day 17 production smoke surface)
3. `tenant-admin-invariant` `removingAdminRows` (latent; caught pre-emptively in Day-17 audit)

**Pattern E established as the codebase convention** for `uuid[]` and `integer[]` array bindings:

```typescript
sqlTag`WHERE col = ANY(${'{' + arr.join(',') + '}'}::uuid[])`
```

**Type-restriction contractual:** Pattern E unsafe for `text[]`, `jsonb[]`, or any type whose values can contain `,`, `{`, `}`, `"`, or whitespace. First contributor introducing such a binding triggers Pattern E re-evaluation per `src/shared/sql-helpers.ts` documentation.

**Discipline rule** — any new repository function (or `sqlTag` call with JS array binding) MUST have a real-Postgres integration test before merge. Mocked-repo unit tests are NOT sufficient. Captured in `memory/followup_repo_layer_integration_coverage_discipline.md`.

**Hotfix lesson:** the FIRST attempt at the fix (Pattern A — `unnest()`) was BROKEN. The integration tests written in the same PR caught it. Without integration tests, Pattern A would have shipped as a no-op. The discipline rule fires as designed.

### Other live rules

- **T2 hard-stop at PR open** — substantive code PRs require reviewer counter-review at PR-open time before merge.
- **No new framework deps in feature PRs** — UserMenu shipped without `@testing-library/react` per this rule; client-component test infra deferred to dedicated PR (`memory/followup_client_component_test_infra.md`).
- **No self-tier escalation** — tier is Love's call; surface the question before drafting.
- **§A applies symmetrically** — when registered contracts under-specify relative to working code, fix the contract.

---

## §5 Repo state at write-time

- **Main HEAD:** `f22cb93`
- **Current branch:** `day17/listvisibletaskids-array-binding-hotfix`
- **Working tree:** dirty with the hotfix work
  - Modified: `src/modules/tasks/repository.ts` (Pattern E applied to `listVisibleTaskIds`)
  - Modified: `src/modules/identity/tenant-admin-invariant.ts` (Pattern E applied to `removingAdminRows`)
  - New: `src/shared/sql-helpers.ts` (Pattern E + type-restriction doc block)
  - New: `tests/integration/list-visible-task-ids.spec.ts` (6 cases, all pass against real Postgres locally)
  - New: `tests/integration/tenant-admin-invariant-array-binding.spec.ts` (5 cases, all pass)
  - New: `memory/followup_repo_layer_integration_coverage_discipline.md` (the discipline-rule memo)
- **Open PRs:** none from today's work; PR #126 stale closed; today's #168 + #169 merged
- **Local verification:** lint silent, tsc clean, 1191/1191 unit tests pass, 11/11 integration tests pass

**Files already committed to main today** (from successful PR merges):
- `memory/PLANNER_PRODUCT_BRIEF.md` (v1.4 + v1.5 amendments)
- `memory/decision_brief_v1_4_amendment_brand_tokens.md`, `decision_brief_v1_5_amendment_color_canon.md`, `decision_day_17_crm_plan_visual_amendment.md`
- `memory/plans/day-17-crm-state-ui.md` (v1.1 amendment included)
- `memory/MEMORY.md` (Day-16 14-item index backfill)
- `memory/followup_logo_asset_optimization.md`, `followup_client_component_test_infra.md`
- 5 net-new Block 4 followups from PR #162
- `public/brand/transcorp-logo.svg` (SVG vector replacing the PNG)
- `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/nav.tsx`, `src/app/(app)/user-menu.tsx`, `src/app/(app)/tasks/page.tsx`, `src/shared/request-context.ts`, `src/shared/tenant-context.ts`, `src/shared/tests/request-context.spec.ts`, `src/app/(app)/tests/user-menu-helpers.spec.ts`, `src/styles/brand-tokens.css`, `tailwind.config.ts`

---

## §6 If auto-compaction fires here, the next builder turn picks up at:

**Step 8-9 of the T2 hotfix workstream:** `git add` the 6 files + commit + push + open PR.

Specific command:

```bash
git add src/modules/tasks/repository.ts \
        src/modules/identity/tenant-admin-invariant.ts \
        src/shared/sql-helpers.ts \
        tests/integration/list-visible-task-ids.spec.ts \
        tests/integration/tenant-admin-invariant-array-binding.spec.ts \
        memory/followup_repo_layer_integration_coverage_discipline.md
```

Then commit with the message specified in the user's last prompt (Step 8 of the hotfix workstream — full multi-paragraph commit message describing the bug, ruled-out alternatives unnest/sql.array, Pattern E with type-safety contract, the broken Pattern A first attempt caught by integration tests, surfaces fixed, and the discipline-rule memo).

Push to origin. Open PR via `gh pr create` with the title `fix(repo): T2 — drizzle array-binding bug in listVisibleTaskIds + tenant-admin-invariant`. Branch-protection: outside the PR #158 path-exemption (touches `src/` + tests/) — full CI gated.

After CI green, surface PR URL + Vercel preview URL + CI status. Reviewer counter-reviews per T2 hard-stop. After merge instruction from Love, sync local main and resume L4 plan PR drafting (which begins with a smoke retest by Love after the hotfix lands).

---

**Standing 10% bootstrap rule remains active.** If context drops below ~10% AGAIN later in this session, write a follow-up `day-17-late-pre-compact-bootstrap.md`.
