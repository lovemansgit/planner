---
name: Don't self-escalate or self-de-escalate the tier of a brief task
description: Tier (T1/T2/T3) is set by the brief and by Love only. If a tier feels wrong, surface the question pre-PR rather than acting on the changed tier silently.
type: feedback
---
**Rule:** Tier (T1 auto-merge / T2 review-then-go / T3 deliberate-double-stop) for any brief task is set by the brief and by Love. Do not change it autonomously.

**Why:** Tier changes blast radius — a T2-marked-as-T3 doubles the hard stops and slows the day; a T3-marked-as-T2 skips a hard stop where Love wanted one. The Day-5 brief §2 establishes "when in doubt, go up a tier" *as a slogan for Love*, not as license for me to escalate without instruction. If a tier seems wrong, that's a design question — surface it the same way I'd surface any other brief errata, not by silently acting on the changed tier.

**How to apply:**

- When the brief specifies a tier in the §6.1-style commit table, follow it exactly.
- When Love specifies a tier in chat (e.g., "T-7 is T3"), follow that — but treat it as authoritative ONLY when stated unambiguously and not as a parenthetical note that could be misread.
- If a parenthetical or aside in Love's message looks like it might be changing the tier, ask before acting. Example: re-read it, and if there's a non-trivial chance it was a typo or a clarification rather than a directive, ask.
- If I genuinely think a tier should be higher (e.g., a T2 task touches RLS unexpectedly during implementation), pause pre-PR and surface the question. Don't open at the higher tier silently.
- Never de-escalate (T3 → T2). The brief's escalations are deliberate.

**Surfacing example:** instead of "I escalated T-7 to T3 because…", say "T-7 is marked T2 in the brief but it touches X — should it be T3? Otherwise I'll proceed at T2." Then act on Love's answer.

**Origin:** caught at the start of T-7 (Day 5, 30 April 2026). I read "T-7 (T3 double-stop)" as a directive to escalate; Love clarified the escalation was unauthorised and corrected — T-7 stays T2.
