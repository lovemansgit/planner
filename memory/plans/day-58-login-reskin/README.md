# Phase 9 · Login reskin — Direction B+ (mockup, rev 2)

**Lane:** design follow-on of B+ (docs + standalone mockup only). **Status:** mockup for Love's eye; the login *code* is being built to this rev. **Method:** `frontend-design` skill, execution mode (the direction is pinned).

## What this is

A **pure visual reskin** of the existing login at [`src/app/login/`](../../../src/app/login/) to the locked B+ skin.

View it (serve from the repo root so the real `public/` assets resolve):

```
# from the repo root of this branch:
python3 -m http.server 8813
# open http://localhost:8813/memory/plans/day-58-login-reskin/login-reskin.html
```

`login-reskin.html` shows the reskinned login (default) plus the failed-sign-in and signing-in states.

## rev 2 — per Love's feedback

- **Live split restored.** The full-bleed split is kept — a clean **white** form panel on the left, the **real cooler-bag photo** (`public/login-hero-cooler-bag.jpg`) co-equal on the right. Not a centred card (rev-1's centred card is retired).
- **Real logo.** The actual `public/brand/transcorp-logo.svg` lockup — no drawn box.
- **White-dominant.** White carries the form panel; cream is only the thin frame + the 3px navy spine. Premium, clean.
- B+ identity = Bricolage display heading, mono eyebrow, sentence-case labels (D2), the single green primary `Log in to Transcorp Planner` on the shipped unified `<Button>`.

## Boundaries (no new scope)

- **No auth-logic change.** The email/password fields, the `loginAction` server action, the `user.login_succeeded` / `user.login_failed` audit events, the `?next=` redirect/sanitiser, and the error + pending states are untouched. Brand-pass, not a flow redesign.
- **Locked palette only** — navy `#252d60`, green `#3e7c4b`; no new brand hex. (White is a surface, per Love's standing white-dominant preference, not a palette change.)
- Adds **no** marketing copy/claims — only the button verb and D2 label casing change.

## Code

The login reskin ships as **its own PR** built to this rev (split + real assets + white form), with a Round-0 self-review + a fresh independent reviewer + an `ORCH-VERDICT`. Visual diff to `src/app/login/page.tsx` + `form.tsx`. No auth-logic change, no migration, no promote. **Parked for Love's clearance — nothing auto-merges.**

## Scope

A visual brand-pass on an existing screen using the locked §3.3.11 tokens — does not by itself need a brief amendment. Surfaced for Love alongside the landing-page mockup (designed as a pair).
