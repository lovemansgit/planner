---
name: E.164 phone display readability for operator-facing UIs
description: Phone is stored + transmitted as E.164 (+971501234567), but operators reading lists/route sheets benefit from humanised formatting (+971 50 123 4567 or local 050 123 4567). Surfaced in C-7 review.
type: project
originSessionId: fa2223f9-8aa2-4dbf-b07b-c846e80677e5
---
C-3 normalises every consignee phone to E.164 on insert/update (PR #20 review note). The C-7 list page (`src/app/consignees/page.tsx`) currently renders `c.phone` directly — `+971501234567` as one unbroken digit blob. That's machine-correct but not friendly when an operator is reading a delivery roster.

**Why:** E.164 is the right canonical storage shape (uniqueness, dedup, easy comparison). It is a known anti-pattern for human-facing display. Surfaced in PR #26 (C-7) review as an operator-readability follow-up: the column is in front of Transcorp ops staff every day; small UX wins compound.

**How to apply:** Add a small `formatE164ForDisplay(phone: string)` helper at the UI layer (`src/app/consignees/_lib/phone-format.ts` or inside the page if scope is small). Two display variants worth considering:

  - **International grouped:** `+971 50 123 4567` — preserves country code, easy to read aloud, copy-pasteable to dialer apps.
  - **Local-equivalent:** `050 123 4567` — what UAE operators actually use day-to-day; lossy on country code.

Recommend international grouped as the default. Keep raw E.164 in the underlying data; format only at the render boundary. When `libphonenumber-js` lands (the C-3 captured note for the second-country onboarding), reuse its formatter rather than rolling our own.

**Where it shows up next:** Day 4 edit/create UI for consignees (whatever input shape we adopt), and any future driver-facing route sheet view. The display formatter should be a single chokepoint so all four surfaces (list, detail, edit, route sheet) stay consistent.

**Surfaced:** PR #26 review, 2026-04-28. Not blocking C-7 merge — read-only Day-3 demo artefact, fix lands with the Day-4 UI work.
