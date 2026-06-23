# Transcorp Planner · public marketing landing — mockup (B+ rev 2)

**Lane:** design (docs + standalone mockup only). **Status:** mockup for Love's ruling on look + structure. **Code:** held until Love gives a directional nod + authorizes the net-new scope (brief amendment) + rules the public route. **Method:** `frontend-design` skill.

## What this is

A **standalone, static mockup** of a **NEW public, unauthenticated marketing page** that sells Transcorp Planner to meal-plan merchants, in B+ continuity.

View it (serve from the repo root so the real `public/` assets resolve):

```
# from the repo root of this branch:
python3 -m http.server 8815
# open http://localhost:8815/memory/plans/day-58-landing-page/landing-page.html
```

## rev 2 — per Love's feedback

- **White-dominant.** White sections carry the page; cream is a thin connective frame only (hairlines + the navy spine). Premium / clean / minimal.
- **Real assets.** The actual `transcorp-logo.svg` (nav + footer); the real `login-hero-cooler-bag.jpg` used **once**, as the single proof moment. No drawn box, no repeated photo, no stock-SaaS clichés.
- **Shorter (MVP).** hero → problem (one block, one visual) → 4 pillars → how-it-works (4 crisp steps) → short proof/CTA → footer. The rev-1 duplicate spreadsheet/Planner compare is gone.
- **4th pillar — merchant control** ("Everything in one place"): manage, track and tailor every subscription from one screen (skip, pause, move a delivery, change address, calendar, CRM states) — not just watch automation.
- **Copy fix:** "A subscription is months of work pretending to be one row." → **"One row. Months of work behind it."**
- Audience/tone: the meal-plan *operations* owner; calm, operator-to-operator; no buzzwords. CTA = `Request access` / `Talk to Transcorp` + `Log in` (no self-serve — onboarded by Transcorp Merchant Success).

## Proof facts — Love-confirmed, printed as fact

Per Love's authority, the proof band prints as fact: **50,000 packages/day · GCC cold-chain leader · 6 markets**, alongside the one verbatim on-record line (*"Transcorp's logistics arm runs cold-chain delivery for meal-plan merchants"*).

> ⚠️ **Tracking note (not a re-litigation):** these three figures are **not yet in the brief** (v1.31 / BRD say *three* markets, not 6, and carry no packages/day or "leader" claim). Love has ruled them correct and authorized printing them. They must be **captured in the brief amendment** Love himself gated below, so the brief stops disagreeing with the live page. The **merchant quote + logos remain PLACEHOLDER** until Love supplies real, approved ones.

## Gates before this goes live (Love's, unchanged)

1. **Net-new scope** — a public marketing page isn't in the brief; §3.3.9 makes `/` the *authenticated* operator home. Needs a `decision_*.md` + a §9 brief amendment + version bump (→ v1.32). **Not self-authorized.**
2. **Route** — because `/` is the authed home, the public page needs its own route (e.g. `/welcome`). Love's decision.
3. **Final copy** — all body copy is placeholder pending Love.

## Code

Scaffold the route + components **behind this mockup** only after the directional nod + scope amendment — placeholder copy, **unlinked / not promoted**, its own PR with Round-0 + independent reviewer + `ORCH-VERDICT`. **Nothing auto-merges.**
