---
name: createBulk vs single-loop — open question, single-loop is the locked default
description: Open as of Day 8 morning (3 May 2026). Love going to SF directly for createBulk response-shape confirmation. Decision criterion locked: single-loop createTask is the default for the C-3 cron push; createBulk is only acceptable if SF confirms (a) per-task SF task IDs on success AND (b) per-task 23505 semantics on conflict. Without both, webhook correlation and reconcile paths break — stay single-loop regardless of speed. Resolution deadline: before D8-4 PR opens.
type: project
---

# createBulk vs single-loop — open question

**Captured:** 3 May 2026 (Day 8 morning, pre-D8-4 work)
**Source:** Day-8 bootstrap brief §7, Day-7 EOD context
**Resolution deadline:** before D8-4 PR opens — last chance to factor createBulk into C-3 push code before it lands

---

## Status

**OPEN.** Love is asking SuiteFleet directly about the `createBulk` response shape. Awaiting answer before D8-4 PR opens.

## Decision criterion (LOCKED)

**Single-loop `createTask` is the locked default.** `createBulk` is only acceptable if SF's response shape provides BOTH:

1. **Per-task SF task IDs on success.** Without per-task IDs, we can't link our local `tasks.id` to SF's `external_id` for the rows in the bulk batch — webhook correlation by `external_id` breaks for everything pushed via bulk.
2. **Per-task SQLSTATE 23505 / "Awb exists already" semantics on conflict.** Without per-task error reporting, we can't run the AWB-regex reconcile path on a per-task basis — the bulk endpoint either fails-the-whole-batch (we lose the rest) or succeeds-with-partial-skips (we don't know which subset).

If either is missing, the per-task semantics that C-3 depends on are not available, and single-loop is the only viable design.

## Why those semantics matter

Two C-3 design points hinge on per-task response shape:

### Webhook correlation

`tasks.external_id` (numeric SF task ID) is how the webhook receiver routes incoming events to our local task rows. Every successful push must populate `external_id` on exactly one local row. Bulk push without per-task IDs in the response means we POST 100 tasks, get back "200 OK", and have zero way to know which SF ID maps to which of our 100 local rows. The next nightly webhook batch then can't be correlated. Pilot breaks.

### 23505 reconcile path

`memory/followup_c3_deferred_day8.md` "23505 reconcile path — AWB regex from error message" specifies: when SF returns "Awb with value TBC-XXX exists already" on a duplicate POST, parse the AWB out via `/Awb with value ([\w-]+) exists already/`, GET the task from SF by AWB, store the SF task ID locally, mark the task as pushed. Without per-task error reporting in bulk responses, we don't know WHICH task in the batch raised the duplicate — the regex has nothing to match against.

## Why single-loop is operationally fine

Production scale: ~7K tasks/night across 50 merchants, hard cap ~10K. Single-loop at 5 req/sec (200ms throttle) = ~33 min for 10K tasks. Vercel Pro 60-min cron limit accommodates with ~27 min headroom.

Pilot scale at 3 merchants is ≤500 tasks/night → ~100 sec push time. No throughput pressure.

Speed is not the bottleneck. Per-task semantics are.

## Resolution paths

### Path A — SF confirms per-task IDs AND per-task 23505 on bulk

Re-evaluate `createBulk` for C-3. Likely still keeps single-loop in pilot (operational simplicity) and revisits as a Day-9+ optimisation when production scale lands. Worth confirming the option exists for future flexibility.

### Path B — SF confirms only per-task IDs (no per-task 23505)

Single-loop stays. Bulk could be a "happy-path only" optimisation post-pilot if conflict rate is empirically zero, but the conditional path complexity isn't worth the speedup at pilot scale.

### Path C — SF confirms neither

Single-loop is the design. No follow-up. Memo closes.

### Path D — No SF response by D8-4 PR open

Single-loop is the design (per the locked default). Memo stays open as a follow-up to revisit if SF responds later.

## Cross-references

- `memory/followup_c3_deferred_day8.md` — full C-3 scope; throttle/AWB-regex/customer.code design that depends on per-task response semantics
- `memory/followup_createtask_idempotency.md` — single-attempt policy on `createTask` (no retry-on-uncertainty); orthogonal to bulk-vs-single-loop but related operationally
- `memory/followup_webhook_auth_architecture.md` — webhook receiver routes by SF numeric `id` and `awb`; both fields must be locally stored to correlate, which requires per-task response data
