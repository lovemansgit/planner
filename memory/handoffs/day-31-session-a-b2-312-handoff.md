# Day-31 Session A handoff — B2 code-PR #312 pre-rotation

**Filed:** 2026-05-18 (Day-30 PM-late, pre-rotation). **For:** Session A pickup on Day-31.
**State:** OPEN, holding for §3.6 hard-stop #2. **NOT YET MERGED.**

---

## §1 — State at park

- **Code-PR:** [#312 — feat(d30): B2 /tasks page cancel + edit (plan #308 v2 §3.6 cleared)](https://github.com/lovemansgit/planner/pull/312)
- **Branch:** `fix/d30-b2-tasks-page-cancel-edit`
- **Pinned commit (verbatim, derived from `git rev-parse`):** `49faf9592a84d87dde561cdd60ec71135196ea40`
- **Commit shape:** SINGLE commit per OQ-7 (carries source + tests + 5 T1 doc artifacts)
- **Plan-PR provenance:** [#308 v2 §3.6 cleared at SHA `9e1efa5bf35bd3af38b79a8532db9d565f66424e`](https://github.com/lovemansgit/planner/pull/308); all 9 OQs locked at that revision.
- **Base:** `origin/main` at `8ff4462` at time of push. Origin advanced once after push to `9751b8f` (#313 docs-only EOD comprehensive; zero overlap, no rebase required).

**Posture:** Builder is parked AFTER the PR-open message landed and CI started. Reviewer §3.6 + CI-green are the merge gates. **No self-merge. No `--admin`. No tier-change. No production action.**

---

## §2 — CI status at park

```
lint + typecheck + test (unit)    PENDING   (build in progress at park)
test (integration)                PENDING   (build in progress at park)
Vercel                            PASS      (preview deployed)
Vercel Preview Comments           PASS
```

**Local pre-push gates green:**
- `npx tsc --noEmit` — clean (no output)
- `npm test` — 1920 / 1920 unit tests pass across 99 test files
- Integration tests require Postgres → CI runs them. Two new specs in this PR (`tasks-page-cancel.spec.ts`, `tasks-page-edit.spec.ts`) will surface in `test (integration)`.

**Day-31 first action:** `gh pr checks 312` to verify CI is now GREEN before any §3.6 body-read interpretation. Per Day-25 §7.1 review-discipline, **red CI is a §3.6 blocker** (no `--admin` without explicit Love authorization).

---

## §3 — The 9 files delivered (single commit `49faf95`)

**Source (2):**
- `src/app/(app)/tasks/_actions.ts` (NEW, 320 LOC) — four server actions: `cancelTaskAction`, `editTaskAddressAction`, `editTaskNoteAction`, `getTaskEditContextAction` + 3 boundary Zod schemas (`AddressEditSchema`, `NoteEditSchema`, each `.strict()`)
- `src/app/(app)/tasks/client.tsx` (MODIFIED, +427 LOC) — Actions column with per-row Cancel + Edit; Cancel disabled-state for ad-hoc rows with tooltip; Edit two-tab modal (Address / Note); success on address edit holds modal ~2.4s to surface OQ-3 verbatim copy

**Integration specs (2):**
- `tests/integration/tasks-page-cancel.spec.ts` (NEW, 303 LOC) — **B2-I1, B2-I2′, B2-I3, B2-I8**. B2-I4 removed per OQ-1 single-canonical-path ruling.
- `tests/integration/tasks-page-edit.spec.ts` (NEW, 222 LOC) — **B2-I5, B2-I6, B2-I7**

**T1 docs (5):**
- `memory/PLANNER_PRODUCT_BRIEF.md` (MODIFIED, +1 row in amendment table + footer marker) — v1.16 append: 1-line cutoff-drift supersede record at brief source-of-truth
- `memory/decision_task_editability_cutoff_at_assigned.md` (MODIFIED, +2 LOC SUPERSEDED header) — Day-3 memo now flags itself as superseded
- `memory/followup_assigned_before_cutoff_dispatch_race.md` (NEW, 41 LOC) — KNOWN pre-existing post-demo hardening edge (not introduced by B2)
- `memory/followup_address_edit_sf_outbound_gap.md` (NEW, 48 LOC) — OQ-3 accepted-gap documentation
- `memory/followup_tasks_page_vs_popover_address_path_asymmetry.md` (NEW, 72 LOC) — OQ-2 intentional MVP asymmetry doc with audit-log UNION pattern for auditors

**Diff stat:** 9 files changed, +1436 / −2 LOC.

---

## §4 — OQ rulings 1–9 — implementation-evidence one-liner each

| OQ | Ruling | Implementation evidence at SHA `49faf95` |
|---|---|---|
| **OQ-1** | SINGLE canonical cancel path; ad-hoc visible-but-disabled + server-side rejection | `_actions.ts:cancelTaskAction` early-returns `{ kind: "validation" }` for `task.subscriptionId === null`; `client.tsx:ActionsCell` button `disabled` when `task.subscriptionId === null` with tooltip "Cancel via SuiteFleet directly — this task has no Planner subscription"; B2-I2′ asserts BOTH layers |
| **OQ-2** | Path A direct column write via `updateTask` | `_actions.ts:editTaskAddressAction` calls `updateTask(ctx, taskId, { addressId })`; NO `subscription_exceptions` row written; B2-I5 verifies `tasks.address_id` updated |
| **OQ-3** | Accept SF-outbound-address gap + VERBATIM UX copy | `_actions.ts:editTaskAddressAction` success result returns exact string `"Address change saved; SuiteFleet will reflect on the next scheduled push pass"`; B2-I5 pins via `expect(result.message).toBe(...)` exact-string assertion |
| **OQ-4** | `addNoteToDriver` (NOT catch-all `updateTask`) | `_actions.ts:editTaskNoteAction` calls `addNoteToDriver(ctx, taskId, notes)`; preserves typed-event audit (`task.note_added`) + PII safety |
| **OQ-5** | Defense-in-depth `.pick({addressId / notes}).strict()` at form-action layer | `AddressEditSchema` + `NoteEditSchema` both `.strict()`; B2-I7 asserts FormData with `deliveryDate` field is rejected before service call with `{ kind: "validation" }` and `enqueueUpdateTask` not invoked |
| **OQ-6** | v1.16 brief append (1-line cutoff-drift supersede); scope-distinct from A1 OQ-7 | `memory/PLANNER_PRODUCT_BRIEF.md` v1.16 row appended to amendment log table; footer `End of v1.16`; entry text records the supersede and explicitly notes scope-distinction from A1 OQ-7 |
| **OQ-7** | Single commit in B2 code-PR | `49faf95` carries all 9 files (source + tests + T1 docs) — verified by `git log --oneline 49faf95 -1` |
| **OQ-8** | Fold read-shape widening into B2 (load-bearing) | **Pre-check passed:** `Task.subscriptionId: Uuid \| null` already declared at `src/modules/tasks/types.ts:134`; `page.tsx` UNMODIFIED. No widening required. |
| **OQ-9** | All 3 followup memos | Three files created in `memory/`: `followup_assigned_before_cutoff_dispatch_race.md`, `followup_address_edit_sf_outbound_gap.md`, `followup_tasks_page_vs_popover_address_path_asymmetry.md` |

---

## §5 — Next action sequence

### On §3.6 APPROVE + CI GREEN

1. Love instructs **squash-merge** (project convention: squash, not merge-commit). Builder runs `gh pr merge 312 --squash`.
2. Confirm post-merge main SHA via `git fetch origin && git rev-parse origin/main`; surface verbatim.
3. Locate the new Vercel deployment built from the post-merge SHA via `gh api repos/lovemansgit/planner/commits/<SHA>/statuses` (filter `context=Vercel`) and `vercel inspect <url> --scope=lovemansgits-projects`.
4. Pre-promote check: confirm CI green on the merged commit; surface NEW preview dpl ID + build status + alias state. Do NOT promote — Love instructs.
5. On Love's promote instruction: `vercel promote <dpl_id> --scope=lovemansgits-projects --yes` (rebuild-against-production-env detour expected per Day-29/Day-30 precedent; report new production dpl + alias swap).
6. Post-promote smoke checklist: app loads (planner-olive-sigma.vercel.app); /login renders; /tasks page renders with Cancel + Edit buttons; alias resolves to NEW dpl.

### On §3.6 REJECT-BACK (defect list)

Defect-list prompt will arrive in this session (or its successor). Patches land as additional commits on `fix/d30-b2-tasks-page-cancel-edit` (do NOT amend `49faf95` — additional commits preserve review history; the user/reviewer can squash at merge time). Re-surface revised pinned SHA + curl-verified raw URLs for re-read. **§3.6 hard-stop #2 re-fires.**

### Always do (per project memory)

- Surface PR URLs verbatim on their own line near the top of the response (per `feedback_always_surface_pr_url.md`).
- Derive SHAs verbatim from `git rev-parse HEAD` / `git rev-parse origin/<branch>` output — NEVER extend a short-prefix SHA by typing (per `feedback_sha_derive_from_git_output_not_prefix.md`).
- Curl-verify raw URLs return HTTP 200 BEFORE surfacing them in a §3.6 message.
- No production SQL. No SF UI actions. No self-merge. No `--admin`.

---

## §6 — Hardest-read surfaces (reviewer-flagged for §3.6 body-read)

The §3.6 reviewer-locked rulings flagged two specific surfaces as the highest-risk read points:

### §6.1 — OQ-5 `.pick().strict()` whitelist boundary on `AddressEditSchema` / `NoteEditSchema` (B2-I7)

**Site:** `src/app/(app)/tasks/_actions.ts` — the two Zod boundary schemas at the top of the file:

```ts
const AddressEditSchema = z
  .object({
    addressId: z.string().uuid({ message: "addressId must be a uuid" }),
  })
  .strict();

const NoteEditSchema = z
  .object({
    notes: z.string().min(1, { message: "Note cannot be empty." }),
  })
  .strict();
```

**Why this is hardest-read:** `UpdateTaskBodySchema` (the underlying `PATCH /api/tasks/:id` route schema at `src/modules/tasks/schemas.ts:34-52`) admits 16 fields including `deliveryDate`, `deliveryStartTime`, `deliveryEndTime`, `internalStatus`, plus 12 others. The OQ-5 defense-in-depth contract REQUIRES that B2's form-action layer narrows the contract to `{ addressId }` or `{ notes }` ONLY — even though the downstream service accepts more. A future maintainer who looks only at `UpdateTaskBodySchema` and sees `deliveryDate` listed will incorrectly conclude the /tasks edit surface admits date edits. **The `.strict()` modifier on these two schemas is the load-bearing primitive** — drop it and the regression silently re-introduces delivery-date editing on /tasks (with the entire B2 OQ-2 vs popover-Path-B-skip-exception-model contract violated). Reviewer body-read should confirm `.strict()` is present on both schemas.

**Pinned by integration spec B2-I7** (`tests/integration/tasks-page-edit.spec.ts`): `FormData` carries both a valid `addressId` AND a `deliveryDate` field; the action MUST return `{ kind: "validation" }` AND `enqueueUpdateTask` MUST NOT be invoked AND the `tasks.delivery_date` row value MUST be unchanged. If the test passes, the `.strict()` contract holds.

### §6.2 — B2-I2′ two-layer ad-hoc cancel rejection (UI disabled + server-side early-return)

**UI layer site:** `src/app/(app)/tasks/client.tsx` — the `ActionsCell` component:

```tsx
const canCancel = task.subscriptionId !== null;
<button
  type="button"
  onClick={() => setOpenModal("cancel")}
  disabled={!canCancel}
  title={
    canCancel
      ? "Cancel this delivery (notifies SuiteFleet)"
      : "Cancel via SuiteFleet directly — this task has no Planner subscription"
  }
  ...
>
```

**Server layer site:** `src/app/(app)/tasks/_actions.ts:cancelTaskAction` — the early-return on `subscriptionId === null`:

```ts
const task = await getTask(ctx, taskId as Uuid);
if (task === null) {
  return { kind: "not_found", message: "Task not found." };
}
// OQ-1 ad-hoc rejection — server-side defense-in-depth. The UI
// renders the button disabled for ad-hoc rows, but a disabled
// button is bypassable via direct POST. This rejection pins the
// contract.
if (task.subscriptionId === null) {
  return {
    kind: "validation",
    message:
      "Ad-hoc tasks cannot be cancelled from /tasks; cancel directly on SuiteFleet.",
  };
}
```

**Why this is hardest-read:** §3.6 OQ-1 OVERRULED Builder's recommended two-path-dispatch design and locked single-canonical-path. The dormant `tasks.cancelTask` service-fn (zero consumers; at `src/modules/tasks/service.ts:1263`) is intentionally NOT un-cobwebbed because of silent-failure risk. The disabled UI state is operator-facing but is BYPASSABLE via direct POST against the server action (a sufficiently-curious or malicious operator can craft a request that hits `cancelTaskAction` with an ad-hoc task id even though the button never appeared enabled). The early-return in `_actions.ts` is the SECOND layer that pins the contract — without it, the disabled-button design alone would be a fig leaf. **Reviewer body-read should confirm both layers are present AND that the server-layer early-return precedes any call to `addSubscriptionException` or `enqueueCancelTask`.**

**Pinned by integration spec B2-I2′** (`tests/integration/tasks-page-cancel.spec.ts`): invokes `cancelTaskAction` directly with an ad-hoc task id (subscription_id IS NULL); MUST return `{ kind: "validation" }` AND NO `subscription_exceptions` row AND NO `tasks.internal_status` change AND `enqueueCancelTask` MUST NOT be invoked AND NO audit row emitted. The five-fold assertion is the load-bearing pin.

---

## §7 — Context anchors for cold pickup

If Session A on Day-31 needs ground truth beyond this memo:

- **Plan-PR #308 v2:** https://github.com/lovemansgit/planner/blob/9e1efa5bf35bd3af38b79a8532db9d565f66424e/memory/plans/day-30-b2-tasks-page-cancel-edit.md — full plan with §10 rulings-locked table; reviewer-cleared at this SHA.
- **A1 plan-PR #306 v3:** https://github.com/lovemansgit/planner/pull/306 — A1 status-mapping defect; FULLY RULED but code-PR gated on Phase-0 production webhook_events evidence (Q-A + Q-B + Q-C SQL in §6 OQ-1 awaiting Love to run). Orthogonal to B2.
- **Day-30 investigation map:** mid-transcript reads at SHA `b86466a` for the original cancel/edit operation inventory; cited inline in the plan §2/§3.
- **Feedback memories worth re-reading at pickup:**
  - `feedback_sha_derive_from_git_output_not_prefix.md` — load-bearing for any SHA-bearing URL surfaced to the reviewer.
  - `feedback_always_surface_pr_url.md` — PR URL on its own line near the top.
  - `feedback_brief_amendment_log_append_only.md` — v1.16 entry is append-only; do NOT retro-edit older entries.
  - `feedback_force_push_requires_pre_authorization.md` — applies if defect-list path requires `--force-with-lease` (it shouldn't; additional commits suffice).

**End of handoff.**
