---
name: UAT GREEN — Day-53 (2026-06-11)
description: Pre-UAT gate closed and UAT declared GREEN on production ce7f8da. Records the gate evidence (Session B public-half checks + Love's authenticated visual walk), the rollback anchor, the audit finding Love ruled (admin nav rename), and the date correction (the "Day-54"-labelled AM dispatches actually occurred 2026-06-11 / Day-53).
type: reference
---

# UAT GREEN — Day-53 (2026-06-11)

**Status: GREEN. The sandbox UAT is cleared to run.**

| | |
|---|---|
| **Production SHA** | `ce7f8da` (promote PR #392 → `production`) |
| **Vercel deployment** | `dpl_7uanHoKoqJ7j6SCN4tTDBDiowgtu` (READY, target=production) |
| **Public URL** | https://planner-olive-sigma.vercel.app |
| **Rollback anchor** | `0665e8c` (EVE promote #384, Vercel `dpl_FvpojyJ…`) — one revert away |
| **What shipped** | #391 UI/UX Tier-1 polish (modal scrim fix, focus rings, branded 404, calendar month-default) **+** Session A's sandbox api_key lane (#387/#388, migration 0030 already applied+verified) + the week's merges |

---

## The gate — closed in two halves

### Public half (Session B, autonomous)

- **Smoke:** `/` → 307, `/login` → 200, `/consignees` + `/calendar` → 307 (auth redirect), bogus path → **404 branded**.
- **demo-preflight: 10/10.** SuiteFleet auth 200 in 625ms (real wire), 1231 consignees, last cron tick 21.5h ago, 18 DELIVERED tasks with POD photos, Sarah Khouri ACTIVE pre-demo with 3 FAILED, Demo Bistro + 7 seeded merchants present.
- **Public-surface render verified (screenshots):** the branded 404 and the login SIGN IN focus-ring are live on production. Console clean (only `/favicon.ico` 404 — pre-existing, cosmetic).

### Authenticated half (Love's visual walk, 2026-06-11)

Love performed the authenticated walk the operator credential gated Session B from doing. All **PASS**:

- `/calendar` **lands on Month**; the Week / Day toggles are intact.
- Modal / drawer / lightbox / confirm **scrim dims** (the headline transparent-backdrop fix renders correctly behind real overlays).
- Tablet-width top nav **wraps cleanly** (no logo/label overlap).
- **Focus rings visible** across the app shell.

---

## Audit finding — ruled by Love

During the walk: **there is no separate Transcorp-admin calendar by design.** Both `/calendar`'s admin branch and `/admin/calendar` render the fleet dashboard — that is intended. The **admin nav label is the only defect**: it reads "Calendar" but points at the fleet overview.

**Love's ruling (verbatim):** "Rename the admin nav entry from 'Calendar' to 'Overview' — admin persona only; merchant persona keeps 'Calendar.' Confirmed by Love, 2026-06-11."

Disposition: a Session B code change (nav label only; path `/admin/calendar` unchanged), cross-reviewed and parked for Love's clearance. It **rides tonight's routine promote — not a pre-UAT one** — so it does not gate the UAT now starting.

---

## Date correction (canonical)

The AM dispatches and rulings labelled **"Day-54 / 2026-06-12"** actually occurred on **2026-06-11 (Day-53)** — a reviewer labelling error; **content unaffected**. The Day-36 = 2026-05-25 anchor puts 2026-06-11 at Day-53.

Already-merged artefacts that carry the "Day-54" / "2026-06-12" wording — the #387–#392 commits, the brief **v1.20** §9 entry ("Day 53/54 NIGHT"), and Love's verbatim merge-clearance quote on #391 ("Confirmed by Love, 2026-06-12") — **stand as written** under append-only discipline. This note is the authoritative correction; the verbatim ruling text is preserved unchanged because verbatim quotes are immutable.

---

## Going into UAT

- **Run the sandbox UAT** on the pre-seeded multi-address consignees (Fatima + the Day-53 probe subscription) per `memory/uat_run_sheet_v1.md`. Probe data stays as demo data, torn down after UAT.
- **Known limitation to say out loud (run-sheet step H):** pause/resume restores the schedule in Planner immediately; the SuiteFleet re-sync for resumed deliveries ships right after UAT (R16, `memory/followup_r16_resume_sf_reactivation.md`).
- **POD live byte-render** remains UAT-opportunistic (needs a within-7-day driver photo upload on SF; the proxy + expired-state path are proven).
- Session B stands by as UAT support — no other build work during UAT beyond the parked admin-nav rename.

## Cross-references

- `memory/uat_run_sheet_v1.md` — the operator script.
- `memory/uiux_audit_day53.md` — the UI/UX audit + Tier-1/Tier-2 split (in #391).
- `memory/PLANNER_PRODUCT_BRIEF.md` v1.20 — calendar month-default amendment (§3.3.3 / §3.3.4 / §9).
- `.github/workflows/promote-to-prod.md` — promote + rollback procedure.
