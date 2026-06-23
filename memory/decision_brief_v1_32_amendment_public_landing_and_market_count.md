# Decision — Brief v1.32 amendment: public marketing landing page + GCC market-count correction

**Date:** 23 Jun 2026 (Day 58, Phase 9 public-surface lane)
**Brief bump:** v1.31 → v1.32 (§9 amendment log; §8 open-questions; §1/§2 framing context)
**Decision class:** Product-definition (Love-ruled). Docs-only — NO src, NO migration, NO promote.
**Source mockups:** #582 (login reskin), #583 (public marketing landing) — Direction B+.

---

## Two related decisions

### 1. NET-NEW SCOPE — public marketing landing page

**Ruling (Love):** Authorize a NEW public, **unauthenticated** marketing landing page that
sells Transcorp Planner to meal-plan / subscription merchants.

- Two entry points only:
  - **"Log in to Transcorp Planner"** — into the existing authenticated app.
  - **"Request access"** — a lead-capture / contact path. **NOT self-serve signup.**
    Merchants are onboarded by **Transcorp Merchant Success**; no public account-creation
    flow is authorized.
- This is the product's **first pre-login surface**. Until now the Planner was defined as a
  Transcorp-owned merchant module entirely **behind login** (§1 framing; every §2.1 operator
  surface — `/`, `/consignees/*`, `/subscriptions/*`, `/tasks`, `/calendar` — is
  authenticated; §3.3.9 makes `/` the authenticated merchant-operator landing).

**Reasoning:** A public sales surface is a genuine scope addition, not a re-skin of an
existing page — it changes the product's framing from "module behind login" to "authed
product fronted by a public marketing page." Per the amendment protocol (§24/§26) new scope
requires an explicit decision + brief amendment + version bump; this memo + v1.32 is that
record.

**OPEN sub-item (recorded, NOT resolved):** the `/`-route ownership question — does the
public landing take `/` (displacing the §3.3.9 authenticated operator landing to a post-login
home / redirect), OR does the public landing live on a separate route with `/` staying the
authed home? **Pending Love's ruling.** Recorded as an open row in brief §8; the landing-page
implementation build is blocked on this decision.

**Love-gated before public go-live:** final marketing copy and ANY proof claims / partner
logos / customer quotes are Love-gated and not authorized for publication until cleared.

### 2. FACT CORRECTION — GCC market count 3 → 6

**Ruling (Love):** The canonical figure for Transcorp's GCC market footprint is **six
markets**, not three. The earlier three-market figure (BRD-level) is **superseded**.

- The public page is authorized to state **"6 markets"** alongside the on-record facts
  **50,000 packages/day · GCC cold-chain leader**.
- **Honesty guard A:** the 50,000-packages/day and "GCC cold-chain leader" claims are NOT
  currently asserted anywhere in the brief body. They remain **Love-gated marketing claims**
  to be finalized before go-live. Only the market count is canonicalized as a corrected fact
  in v1.32.
- **Honesty guard B:** the three seeded production SuiteFleet regions in §3.1.1 (`transcorp`
  KSA / `transcorpuae` / `transcorpqatar`, plus `transcorpsb` sandbox) are Planner↔SF
  **integration config** — a separate concern from the business market footprint. The 3 → 6
  correction is a business/marketing fact and does **NOT** change the seeded region set; no
  schema/seed delta rides this amendment.

---

## What changed in the brief (additive-only; append-only log respected)

1. **§9 amendment log** — new `v1.32` row appended (rows above untouched).
2. **§8 open questions** — new row: public landing `/`-route ownership → Pending Love's ruling.
3. **`**Version:**` pointer** — v1.31 → v1.32.
4. **Closing line** — `**End of v1.31.**` → `**End of v1.32.**`.

NOT touched: the `**Filed:**` sentence (frozen at v1.15 since v1.16; the §9 table is the
authoritative log). No §1/§2 body rewrite — the framing shift is carried in the v1.32 entry,
which §1/§2 now read against.

## Scope boundary

This entry **authorizes the scope and corrects the fact only**. The landing-page
implementation is a separate forthcoming code build that will reference
`PLANNER_PRODUCT_BRIEF.md §1/§2` + this amendment, and is blocked on the §8 `/`-route ruling.

## References

- Brief: `memory/PLANNER_PRODUCT_BRIEF.md` §9 (v1.32), §8, §1, §2, §3.1.1, §3.3.9
- Mockups: #582 (login reskin), #583 (public marketing landing)
- Docs PR: rides the #566 docs-only fast-lane.
