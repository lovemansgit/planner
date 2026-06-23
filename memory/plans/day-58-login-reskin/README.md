# Phase 9 · Login reskin — Direction B+ (mockup)

**Lane:** design follow-on of B+ (docs + standalone mockup only). **Status:** mockup for Love's ruling on look. **Code:** blocked until the B+ component stack (3.3–3.6) fully resolves on `main`; this file has no code dependency.

**Method:** the `frontend-design` skill, in *execution* mode — the direction is pinned (B+), so this is "build to the locked skin", not exploration.

## What this is

A **pure visual reskin** of the existing login at [`src/app/login/`](../../../src/app/login/) to the locked B+ skin. View it:

```
cd memory/plans/day-58-login-reskin
python3 -m http.server 8813
# open http://localhost:8813/login-reskin.html
```

`login-reskin.html` shows the reskinned login in its default state, plus the two behavioural states (failed sign-in, signing-in) reskinned so the full surface is legible.

## The reskin, in one move

The current login is editorial — uppercase tracked labels, underline inputs, an outlined navy submit button, a full-bleed cooler-bag photo split. B+ resolves it to **calm**: a single floating warm-white card with the 3 px navy spine on the cream field, Bricolage Grotesque heading, a mono eyebrow, **sentence-case labels (D2)**, warm rounded inputs with a green focus ring, and the **one green primary action** — `Log in to Transcorp Planner` — drawn on the shipped unified `<Button>`.

The card deliberately echoes the marketing landing page's hero so the public site and the app read as **one continuous thing** (the login is the bridge between them).

## Boundaries honoured (no new scope)

- **No auth-logic change.** The email/password fields, the `loginAction` server action, the `user.login_succeeded` / `user.login_failed` audit events, the `?next=` redirect/sanitiser, and the error + pending states are all untouched. This is a brand-pass, not a flow redesign.
- **Locked palette only** — navy `#252d60`, green `#3e7c4b`, cream field `#efeae0`; no new hex.
- **No new copy that carries marketing claims.** The only label changes are the button verb (`Log in to Transcorp Planner`) and switching the section labels to sentence case per D2. The lede keeps the existing operator-voice line. (`Operator access is provisioned by Transcorp.` is a one-line, factual footnote consistent with the brief's onboarded-by-Transcorp model — flagged here in case Love wants it cut.)

## One decision left to Love

**Layout:** keep the shipped photo-split, or move to the single centred card?
- **Recommendation — centred card.** Calmer, more B+, and continuous with the landing hero.
- **Alternative — keep the split.** The same B+ card sits in the left half; the cooler-bag photo stays in the right half with a warm navy-tint overlay to sit inside the palette. A one-line layout choice, not a rebuild.

## When this becomes code

Once B+ (3.3–3.6) is confirmed on `main`, the reskin ships as **its own PR** with a Round-0 self-review against the reviewer checklist, a fresh independent reviewer, and an `ORCH-VERDICT` — same gate as any code PR. The diff is small and visual: `src/app/login/page.tsx` (layout + card) and `src/app/login/form.tsx` (Button + Field styling). No migration, no promote.

## Scope note

A *visual* reskin using the locked §3.3.11 brand tokens is a brand-pass on an existing screen. It adds **no** new marketing copy or claims, so it does **not** by itself need a brief amendment — but it is surfaced for Love's directional ruling alongside the landing-page mockup, since the two are designed as a pair.
