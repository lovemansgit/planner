---
name: UAT run sheet v1 — scripted operator flows for the first Ops UAT
description: Plain-English, step-by-step operator script for the first Ops UAT, run on the pre-seeded multi-address consignees (Fatima + the Day-53 probe subscription) per Love's Day-53 EVE ruling. Each step gives what the operator does, what they should see, and which pre-seeded row to use; state-consuming steps are flagged and ordered last.
type: reference
---

# UAT run sheet v1 — first Ops UAT

**For:** the Ops operator running the first hands-on UAT. Read top-to-bottom and
do the steps **in order** — the order is chosen so the read-only and reversible
demos all work before any step that consumes a delivery.

**Ruling basis:** Love's Day-53 EVE check-in — UAT runs on **pre-seeded
multi-address consignees**, and the Day-53 sandbox probe data is **kept as the
UAT demo data, torn down after UAT** (`memory/decision_d53_eve_final_clears.md`).
The Phase-2 "add a second address" UI is **not** required for this UAT (it ships
before real merchants onboard) — that's why we use a pre-seeded 2-address
consignee (`memory/followup_no_ui_second_consignee_address.md`).

---

## 0. Before you start

| | |
|---|---|
| **Where** | https://planner-olive-sigma.vercel.app |
| **Sign in as** | the UAT operator account (ask Love for the credentials — not in this doc) |
| **Tenant** | Meal Plan Scheduler (shown top-right as `mpl-admin`) |
| **What "SuiteFleet" means here** | the live delivery system. When a step says "SuiteFleet got it," that's the real integration firing — not a mock. |

### Pre-seeded people you'll use

| Consignee | What they're for | Notes |
|---|---|---|
| **Fatima Al Mansouri** | the main demo — calendar, skip, move, pause, note, **address change** | Has **two** addresses: **Home** (Villa 12, Jumeirah Beach Road) and **Office** (Office 1502, Bay Square Tower 5, Business Bay). Has a **probe subscription** (the "16:00–18:00" deliveries, Mon–Fri) created Day-53 with deliveries from 11 Jun through 2 Jul. |
| **Sarah Khouri** | history / failed-delivery story | Three failed deliveries on record (a deteriorating pattern), single address. Good for the History drawer. |
| **Roudy M** | a single-address consignee | Used Day-52 for notes/skips; only one address (so address-change actions show just the one address). |
| **POD photo rows** | proof-of-delivery viewing | Four older delivered orders carry real SuiteFleet photos: `MPL-80355079`, `MPL-38610276` (20 May), `MPL-02403404`, `MPL-53512916` (21 May). |

> **Find a consignee:** top nav → **Consignees** → type the name in search → click the name.

---

## The flows

Steps **A–E** are read-only or additive — safe to run any time, any order.
Steps **F–H** change state but are **reversible**. Steps **I–J** **consume a
delivery** — do them **last**, and on deliveries you won't need afterward.

### A. Onboarding view (read-only)

- **Do:** Consignees → search **Fatima Al Mansouri** → click her name. Stay on the **Overview** tab.
- **Should see:** her name, phone, email, the **Home** address, an **Active** status pill, and buttons for **Edit / New subscription / Add ad-hoc task / Change state**.
- **Why it matters:** this is the at-a-glance card an operator lands on for any subscriber.

### B. Calendar (read-only)

- **Do:** on Fatima's page, click the **Calendar** tab. Make sure it's on **Month** / June 2026.
- **Should see:** **"Scheduled 16:00–18:00"** deliveries on the weekdays (11, 12, 15–19, 22–26, 29, 30, and into July). Weekends are empty.
- **Then:** click any one delivery → a panel opens showing **Status, Window, Task ID**, and a list of actions.

### C. History drawer (read-only)

- **Do (task history):** on Fatima's calendar, open any delivery → **View task timeline**.
- **Should see:** a timeline like **Created (SYSTEM) → Updated / Ordered (SUITEFLEET WEBHOOK)** — i.e. Planner created it and SuiteFleet confirmed it. This is the live two-way link.
- **Do (account history):** click the **History** tab on Fatima's page.
- **Should see:** a list of recorded actions (e.g. the address overrides from earlier testing), newest first, each with a timestamp.
- **Optional (richer story):** open **Sarah Khouri** → her history/timeline shows **three failed deliveries** — useful to show how problems surface.

### D. POD (proof-of-delivery) photo view (read-only)

- **Do:** top nav → **Tasks** → set the status filter to **Delivered** and the date range to cover **May 2026** → find order **`MPL-80355079`** (or `MPL-38610276` / `MPL-02403404` / `MPL-53512916`) → click its **proof-of-delivery** icon (the bag icon on the right of the row; coloured rows have photos, greyed rows don't).
- **Should see (these four older orders):** a "Proof of delivery" panel opens with a **broken-image placeholder** labelled "Proof of delivery photo". That's **correct and expected** — these photos were delivered in May, and SuiteFleet's photo links expire after 7 days, so they're dead at the vendor. The point being demonstrated: Planner shows the operator an **honest empty state**, and never exposes or errors on the raw vendor link. (Before this fix the operator saw a confusing broken glyph that leaked the vendor URL.)
- **For a LIVE photo (do this opportunistically during UAT):** the first time a driver completes a **fresh** sandbox delivery **with** a photo upload, find that order (delivered within the last 7 days) and open its POD — the actual photo should render in the panel. There was no within-7-day delivered-with-photo order to demo at sheet-writing time (see §POD-RESULT).
- **Why it matters:** POD photos are served **through Planner**, so the operator's browser never touches SuiteFleet's storage links directly.

### E. Driver note (additive — safe)

- **Do:** Fatima → Calendar → open a **future** delivery (e.g. a day next week) → **Add note to driver** → type a short note → save.
- **Should see:** a confirmation, and (after a moment) the delivery's timeline shows the note was **sent to SuiteFleet** (the driver-facing note lands on the real task).
- **Note:** additive only — doesn't remove anything.

### F. One-off address change — ⭐ the integration "wow"

- **Do:** Fatima → Calendar → open a future delivery **still on the Home address** → **Change address (this delivery only)** → pick **Office (Bay Square Tower 5)** → **Override for this delivery**.
- **Should see:** the panel confirms the change; briefly a **"Sending to SuiteFleet"** marker appears on that delivery, then clears once SuiteFleet acknowledges.
- **Prove it reached SuiteFleet:** re-open that delivery → **View task timeline** → there's a fresh **Updated · SUITEFLEET WEBHOOK** entry — SuiteFleet received the new address and echoed it back. This is the moment to highlight: **the address change actually reached the delivery system.**
- **Reversible:** repeat and pick **Home** to put it back.

### G. Forward address change — ⭐ the fan-out "wow"

- **Do:** Fatima → Calendar → open a future delivery still on Home → **Change address (from this delivery onwards)** → pick **Office** → click the green button → a confirmation popup appears reading **"Are you sure you want to update the address for all future tasks on this subscription?"** → **Yes, update address**.
- **Should see:** **every** upcoming delivery from that date forward switches to the Office address, and SuiteFleet is told about **each one** that's already dispatched.
- **Prove the fan-out:** open two or three of the later deliveries → each timeline shows a fresh **Updated · SUITEFLEET WEBHOOK** at the same time. A delivery **before** the date you picked is untouched (no new entry) — the change only moves forward.
- **Why it matters:** one action, every future delivery re-pointed and the delivery system kept in sync.

### H. Pause / resume (reversible)

- **Do (pause):** Fatima → Calendar → open a delivery → **Pause from this date** → set a short window (a couple of days) → confirm.
- **Should see:** the deliveries inside the window switch to **Canceled**; the subscription's end date extends to make up for them. SuiteFleet is told to cancel the paused deliveries.
- **Do (resume / undo):** _(if the build exposes a resume action, use it to restore; otherwise this is the one window to leave paused for the demo)._ Flag to Love if resume isn't surfaced.
- **⚠️ Known limitation to say out loud (don't skip):** **Resume restores the schedule in Planner immediately; the delivery-vendor (SuiteFleet) re-sync for resumed deliveries ships right after this UAT.** So on resume the calendar is correct in Planner, but re-activating those deliveries on SuiteFleet's side is the very next build (R16). Demo this honestly — it's a known, scheduled gap, not a surprise.
- **State note:** changes the calendar but is designed to be reversible — keep the paused window small.

### I. Skip — ⚠️ consumes a delivery

- **Do:** Fatima → Calendar → open a delivery **you won't need for later steps** → **Skip this delivery** → confirm (default rules add a make-up delivery at the end).
- **Should see:** that day flips to **Skipped**; a make-up delivery appears further out; SuiteFleet is told to cancel the skipped one.
- **Order:** do this **after** the address/pause demos so you don't skip a delivery you wanted to show.

### J. Move (skip with override) — ⚠️ consumes a delivery

- **Do:** Fatima → Calendar → open a delivery → **Skip with override** → choose a specific new date (or skip with no make-up) → confirm.
- **Should see:** the original day clears and the delivery reappears on the chosen date.
- **Order:** last — it rearranges the calendar.

---

## §POD-RESULT — Day-53 EVE POD wire check (done)

Verified on production after #377/#384 (full record:
`memory/handoffs/day-53-eve-pod-proof.md`):

- The four May POD orders' photos are served through Planner's same-origin proxy
  (`/api/tasks/{id}/pod/{index}`); the raw SuiteFleet link never reaches the
  browser. ✅
- Those links are all **past their 7-day expiry**, so the proxy returns a clean
  "gone" response and the operator sees the **honest broken-image placeholder** —
  not a leak, not a mystery error. ✅ (This is what step D will show on these
  rows.)
- A **live photo render** could not be demonstrated at write time: no delivered
  order on the sandbox is within the 7-day window, and a fresh one needs a driver
  to upload a photo in the SuiteFleet app (not something Planner can trigger). The
  byte-streaming path is built and unit-tested; prove it **opportunistically**
  during UAT on the first fresh delivered-with-photo order. ⚠️ open sub-leg.

---

## After the UAT

Per Love's ruling, the Day-53 sandbox probe data (Fatima's probe subscription +
its SuiteFleet tasks) is **demo data for this UAT, torn down afterward**. Don't
delete it mid-UAT. Teardown is a follow-up once UAT wraps.

## Cross-references

- `memory/decision_d53_eve_final_clears.md` — Love's Day-53 EVE ruling (basis for this sheet).
- `memory/handoffs/day-53-pm-proving-pass.md` — the R4/R5 address-change proof (steps F/G are the demo version of it).
- `memory/uat_mvp_scope_definition.md` — what's proven vs. open going into UAT.
- `memory/followup_no_ui_second_consignee_address.md` — why we pre-seed a 2-address consignee.
