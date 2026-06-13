# Day-54 PM-2 EOD — Session A (2026-06-12)

Firing: "#496 cleared. #497 cleared." + 5-step closeout + mid-flight ADDITION
(tasks-row visual polish T2).

## 1. Clearance merges (Action route, clearances quoted in ORCH-CLEARANCE)

| PR | What | Merge SHA |
|----|------|-----------|
| #496 | churn role gate — `consignee:churn`, merchant-level only (brief v1.27) | `376b2763d55c09595773b58128948d5eb5829bf4` |
| #497 | /tasks row-lock affordance (editability.ts + ActionsCell) | `2e78fd689032743ceee1574b43fd4b663d26ab75` |

## 2. ADDITION — tasks-row visual polish (T2, UI-only)

Built on fresh main post-#497. Layout-only diff: px-3/py-3 cell rhythm with
flush outer edges, header font-semibold + tracking-[0.14em], AWB stacked
cell tidied (inline-flex gap), address truncation at max-w-[16rem] with full
value on hover. Zero behavior/data change; 9-column ruling untouched.
tsc/eslint clean, tasks suite 28/28. PR **#499** — APPROVE r1, and the
dispatch's ride condition ("may ride… does not WAIT beyond one review
round") was satisfied, so it MERGED `ff6ee2bb2e7af8b46d97ebd4e80bdd4753dcb72c`
and rode the promote.

**Process event (3rd recurrence — threshold met):** the FIRST #499 reviewer
finished its body-read (APPROVE) but was classifier-denied posting the
verdict. Remedy: fresh re-dispatch; second reviewer independently posted
APPROVE r1. Allow-rule now FILED for Love's paste — see
`memory/followup_automerge_hardening_observations_d54.md` (b):
`"Bash(gh pr comment*ORCH-VERDICT*)"`.

## 3. THE PROMOTE (routine, dispatch step 2)

- Promote PR **#501** (production ← main @ `ff6ee2b`), precondition clean
  (only prior promote squashes + known `15c55e4`), APPROVE r1, clearance
  armed BEFORE verdict — wait-not-park held and the verdict re-triggered
  (second live proof of the #485 semantics).
- MERGED: production squash `d3b8fb470f16a85bf0e5ec93c4a6ff481bb13e1b`.
- **Deployment: `dpl_Bk2RaHWfE66EEpsAHLp2jVpaKw67` READY**, aliased
  planner-olive-sigma.vercel.app, region bom1.
- **Rollback anchor: promote squash `3045982`**
  (dpl_6S7UWVEZd8zeGcnZCqZw8aQDsqK8).

## 4. Post-promote spot-checks (live wire, production)

- **(a) Churn gate — PASS, server-verified.** UI: Transcorp admin's tenant
  has 0 consignees (no surface at all); positive control: operator
  (mpl-admin) radio list on a real consignee SHOWS Churned. Server: captured
  the CRM server-action wire shape as operator using an INVALID to_state
  (Zod refuses — zero mutation), replayed it under the ADMIN session with
  to_state=CHURNED → response = `forbidden` ("You don't have permission…").
  The gate fires before any DB work. Probe consignee `5071ebd6` re-checked:
  still Active, untouched.
- **(b) Row lock — PASS.** /tasks?status=ASSIGNED row MPL-40595232: Cancel
  AND Edit disabled, title verbatim "Assigned to a driver — this delivery is
  locked. No edits or cancellations once assigned; notes to the driver still
  go through."
- **(c) Polish at density — PASS.** /tasks with a wide date range renders
  50/50 rows (527 total), clean rhythm, no overflow breakage; today-filter
  default shows the single Fatima task correctly polished.

## 5. Reviewer worktree standing order (dispatch step 4)

`.claude/agents/reviewer.md` new §3b: never leave the assigned worktree;
outside paths read-only via git plumbing, never cd. Parks per path gate
(`.claude/**` outside allowlist): **PR #500, parked-t2, APPROVE r1 at
`b71b5a4`** — one-liner: "#500 cleared."

## 6. Queue + rulings (updated by the closing amendment)

- "#500 cleared." rode the closing amendment — #500 merged via the Action
  clearance route (`a54a794`).
- Queue = **#502 only** — a plan-only T3 PR (bag tracking reports, Asset
  Tracking + Inventory) from a parallel lane, labeled
  `needs-directional-ruling`. Not this lane's to act on; it awaits Love's
  directional ruling per the T3 plan-PR protocol.
- The verdict-posting allow-rule was **REJECTED by ruling**: it cannot
  distinguish reviewer from builder under shared session permissions, so it
  would let the builder post promptless verdicts the Action acts on — the
  seam outranks the convenience. Standing remedy stays
  fresh-reviewer-redispatch; revisit post-UAT with an authorship-preserving
  design (recorded in the followup memo).

Lane idles for UAT proper. UAT prerequisites intact: MPL-40595232 ASSIGNED
(lock demo), Fatima demo data untouched, run sheet v2 GREEN on main, and the
churn gate + row lock + polish are now ON PRODUCTION for the UAT walk.
