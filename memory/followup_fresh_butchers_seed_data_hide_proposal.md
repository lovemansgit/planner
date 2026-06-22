---
name: followup_fresh_butchers_seed_data_hide_proposal
description: Proposal to HIDE Fresh Butchers dev-seed junk (500 SEED-FBU-* consignees/subscriptions + their cron tasks) while keeping the merchant alive for real future data — investigation + options, no data written
metadata:
  type: project
---

# Fresh Butchers — hide the dev-seed junk, keep the merchant (proposal)

**Status:** INVESTIGATION + PROPOSAL ONLY. No database row was read or
written by this session; no migration applied. Pinned to `main @ 04ca9214`.
Floor 1 holds — any *data* change below parks for Love's named sentence.

**One-line ask for Love:** Fresh Butchers (`fresh-butchers`, code FBU) is a
real merchant we keep, but it's full of ~500 fake "FBU Customer ####"
consignees a builder script seeded during development. We want that junk
**hidden everywhere** (now and going forward), while any **real** Fresh
Butchers data flows through normally. This memo says exactly how the junk is
marked, how much there is, and the cleanest way to hide it.

---

## 1. How the junk got there (confirmed from the code)

The junk was minted by two committed builder scripts, run once during the
P3 demo build (Day 11):

- [scripts/seed-subscriptions.mjs](scripts/seed-subscriptions.mjs) — the bulk seeder.
- [scripts/seed-subscriptions-config.mjs](scripts/seed-subscriptions-config.mjs) — the per-merchant recipe. The `fresh-butchers` profile says **500 consignees, 1 subscription each** ([config L72-92](scripts/seed-subscriptions-config.mjs#L72-L92)).

Every seeded row was deliberately stamped with a **machine marker** so the
script could detect its own prior runs. That same marker is now our clean
"this is junk" signal:

| What | Marker on the row | Example |
|------|-------------------|---------|
| Consignee | `external_ref` = `SEED-FBU-CON-####` | `SEED-FBU-CON-0001` … `SEED-FBU-CON-0500` |
| Subscription | `external_ref` = `SEED-FBU-SUB-####` | `SEED-FBU-SUB-0001` … `SEED-FBU-SUB-0500` |
| (corroborating) name | `FBU Customer ####` | `FBU Customer 0442` |
| (corroborating) phone | `+971540…` | `+9715400000442` |
| (corroborating) address | `Building ####, <district>, <region>` | `Building 0442, Deira, Dubai` |

The `external_ref` prefix is the durable one. It is set on **every** seeded
consignee and subscription ([seeder L153-155, L191-238](scripts/seed-subscriptions.mjs#L189-L238)), it is exactly what the
script itself greps to avoid double-seeding (`external_ref LIKE 'SEED-%'`),
and it is **never** written by the real data paths. Real Fresh Butchers data
arrives from SuiteFleet inbound webhooks / genuine consignee creation, which
do not stamp `SEED-FBU-`. So the marker is a *positive identifier of junk* —
it can only catch seed rows, never real ones.

---

## 2. Blast radius

**Junk, by construction (from the recipe):**

- **500 consignees** (`SEED-FBU-CON-0001..0500`).
- **500 subscriptions** (`SEED-FBU-SUB-0001..0500`), all `status = 'active'`,
  cadence Tue + Fri, 17:00–19:00 Asia/Dubai.
- **Tasks**: *not seeded directly.* The daily task-generation cron mints them
  from those 500 active subscriptions. Tasks carry **no** `external_ref` — a
  task is junk iff its `consignee_id` / `subscription_id` points at a
  `SEED-FBU-` row. Live count is unknown without a read; a Day-14 cron note
  records "114 fresh-butchers tasks at Day-14 plan time," and since the subs
  are still `active` the count has grown every Tue/Fri since.
- **No `addresses` / rotation / CRM-event rows** in the FBU blast radius —
  the bulk seeder writes a denormalised `address_line` on the consignee only.
  (The `addresses`/persona rows from `seed-demo-personas.mjs` target
  `meal-plan-scheduler`, **not** FBU — out of scope here.)
- The new `seed-bag-tracking-synthetic.mjs` targets `demo-bistro`, **not** FBU
  — also out of scope.

**Real data check:** any `fresh-butchers` consignee/subscription **without**
`external_ref LIKE 'SEED-FBU-%'` is real. The hide rule keys on the junk
marker, so it cannot touch a real row even if one already exists. The exact
junk-vs-real split should be confirmed with the **read-only** count query in
§5 before flipping the filter on, but the design is safe either way.

**Why "delete" is the wrong verb anyway:** `tasks.consignee_id` is
`ON DELETE RESTRICT` and the `audit_events_no_delete` rule blocks teardown —
deletion would be fought by the schema. This is the same "hide, don't delete"
posture Love already chose for the 1,825 test tenants (#546). We keep the
merchant; we hide its seed rows.

---

## 3. The durable marker — options + recommendation

The key design question: *what reliably says "dev seed" vs "real," such that
current junk hides and future real data passes through?*

| Option | What it is | Migration? | Backfill (prod write)? | Verdict |
|--------|-----------|:----------:|:----------------------:|---------|
| **A. `external_ref` prefix** ⟵ **recommend** | Hide rows where `external_ref LIKE 'SEED-FBU-%'` (tasks: via FK to such a consignee/subscription) | **No** | **No** — marker already on every row | Safest. Positive junk identifier, already in the data, zero data change. |
| B. Name/phone heuristic | `name LIKE 'FBU Customer %'` or phone `+971540%` | No | No | Use only as a cross-check. Weaker — a real customer could collide; "FBU Customer" is a label, not a guarantee. |
| C. Date cutoff | Hide FBU rows created before a chosen date | No | No | Rejected. Crude — would also hide real rows created in that window, and let future-dated junk (cron tasks) through. |
| D. New flag column `is_seed_data` | Add a boolean, set it true on the junk | **Yes (parks)** | **Yes (parks)** | Clean in theory, but needs a schema change *and* a backfill of the existing rows — two Floor-1 parks — to replicate a signal `external_ref` already gives us for free. Not worth it. |

**Recommendation: Option A.** The marker already exists on 100% of the junk
and on 0% of real data. No migration, no backfill — we just stop *showing*
the marked rows.

---

## 4. What the fix actually needs

| Piece | Needed? | Parks (Floor 1)? |
|-------|:-------:|:----------------:|
| Migration / schema change | **No** (Option A) | — |
| Data backfill / any prod row write | **No** for the hide itself (read-path filter) | — |
| **Code** — a read-path "hide seed rows" filter | **Yes** | No (code PR, normal gate) |
| **Code** — stop the cron minting *new* FBU junk (companion, see below) | Recommended | No (code PR) |

### Is #546's `buildGenuineTenantsFilter` the right shape?

**Right *shape*, different *level* — copy the pattern, don't call the function.**

- #546 / [genuine-merchants.ts](src/modules/merchants/genuine-merchants.ts) filters at **tenant** granularity ("which *merchants* show"). It actually **allowlists `fresh-butchers` as genuine** — so it keeps the whole merchant visible. It will never hide rows *inside* a genuine tenant. So we are not reusing it.
- What we need is the **same engineering pattern** one level down, at **row** granularity inside a genuine tenant: one centralized predicate, a single source of truth, **SQL + JS renderings cross-checked by tests so they can't drift**, read-path only, no deletion, no migration — exactly the discipline that file already models. We add a sibling, e.g. `excludeSeedRows()` / `isRealRow()`, keyed on `external_ref NOT LIKE 'SEED-%'`, and compose it into the queries behind every surface that lists consignees / subscriptions / tasks (admin consignees, admin subscriptions, admin tasks, calendar, merchant operator lists, top-merchants panel, asset-tracking reports). Mirror #546's two-rendering + cross-test rule verbatim.

### Companion: stop generating *future* junk (code-only)

A read-path filter hides junk from screens, but the 500 seeded subscriptions
are still `active`, so the task-generation cron (fresh-butchers is
cron-eligible — it has customer_code 578) keeps minting new junk tasks every
Tue/Fri. Worse, generated tasks default to outbound-sync `pending`, so **if
outbound sync is live for FBU these fake butcher deliveries may be getting
pushed to SuiteFleet** (worth confirming with a read). The clean,
**no-data-write** remedy is to extend the same `SEED-%` exclusion into the
cron's subscription-selection query so it skips seeded subscriptions. The
data-write alternative — flipping the 500 subscriptions to non-active —
**parks** and isn't necessary if we do the code exclusion.

---

## 5. Read-only diagnostic to confirm exact live counts (optional, no writes)

Run against prod read replica / pooler to pin the real blast radius and prove
"no real rows caught" *before* the filter ships. **Reads only:**

```sql
-- counts under fresh-butchers, split junk vs real
SELECT 'consignees' AS kind,
       count(*) FILTER (WHERE external_ref LIKE 'SEED-FBU-%') AS junk,
       count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE 'SEED-FBU-%') AS real_or_other
FROM consignees c JOIN tenants t ON t.id = c.tenant_id WHERE t.slug = 'fresh-butchers'
UNION ALL
SELECT 'subscriptions',
       count(*) FILTER (WHERE external_ref LIKE 'SEED-FBU-%'),
       count(*) FILTER (WHERE external_ref IS NULL OR external_ref NOT LIKE 'SEED-FBU-%')
FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = 'fresh-butchers';

-- task fan-out off seeded subscriptions
SELECT count(*) AS junk_tasks
FROM tasks tk JOIN tenants t ON t.id = tk.tenant_id
JOIN subscriptions s ON s.id = tk.subscription_id
WHERE t.slug = 'fresh-butchers' AND s.external_ref LIKE 'SEED-FBU-%';
```

If `real_or_other` is 0 we've confirmed the merchant has *only* junk today,
and the filter is provably safe. If it's >0, those are real rows we must keep
visible — the marker-based filter already does that, but we'd eyeball them.

---

## 6. Decision for Love + the authorization that unlocks each path

**Recommended path is CODE-ONLY** (read-path `SEED-%` filter + cron exclusion):
no migration, no data write → it does **not** trip Floor 1. It proceeds as a
normal builder PR + independent reviewer + server-side merge gate.

To proceed, Love's sentence authorizes one of:

1. **Build the recommended fix (Option A, code-only).** e.g. *"Build the
   Fresh Butchers seed-hide: read-path `SEED-%` filter on the row surfaces
   plus cron exclusion, code-only, no data writes — Option A."* No data
   authorization needed.
2. **Also run the read-only diagnostic first** (§5) to confirm counts. Read
   only; say so if you want it run before the build.
3. **(Only if Love prefers a data approach)** deactivating the 500 seeded
   subscriptions, or the flag-column option D — **these write prod and PARK**
   for a named per-statement SQL authorization. Not recommended; not needed.

**Builder's recommendation:** authorize #1 (code-only Option A + cron
exclusion). Optionally #2 first for proof. Avoid #3 — `external_ref` already
gives us a clean, reversible, zero-write hide.
