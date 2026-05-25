---
name: Verify framing against the running product
description: Two related discipline rules for surfacing prior rulings, diagnostics, and framings as load-bearing context. (A) Name in source language, never paraphrase. (B) Reality-check against the live product before relying on a prior diagnostic framing. Filed Day 36 after the R7.2 view-mode-default thread closed Day-33 as a third paraphrase-into-symptom-framing error in two days.
type: feedback
---

# Verify framing against the running product

**Surfaced:** Day 33 (22 May 2026), R7.2 view-mode-default rulings session — the third paraphrase-into-symptom-framing instance across two days. Filed Day 36 (25 May 2026) as a durable home so the discipline rule does not live only inside the Day-33 EOD handoff (which will historical-archive).

Two related but distinct rules. Both feed the same principle — the running product wins over any paraphrase or stale framing of it — but their corrective actions differ.

## §1 Rule A — Name in source language, don't paraphrase

Source: [`memory/handoffs/day-33-eod.md`](handoffs/day-33-eod.md) §F discipline lesson #1, verbatim:

> **"Bootstrap briefs MUST quote §10 plan rulings verbatim, never paraphrase into symptom framing."** Reviewer-side error twice today: F-4 framed as "SELECT FOR UPDATE concurrency race" (actual: route handler bypasses service layer); R7.2 framed as "month default" (actual at the time: week default — though reality is month, see #9). Builder ignored both paraphrased framings and verified against ground truth — correct discipline.

The reviewer-side discipline against paraphrasing a ruling or surface into a symptom-framing. The R7.2 instances over Days 32-33 paraphrased "view mode default" into "month default" / "week default" — both partial in different ways. The F-4 instance paraphrased a routing-layer bug into a concurrency-race framing — a different bug shape entirely.

**Corrective action:** when surfacing a prior ruling or diagnostic in a bootstrap brief, plan PR, reject-back, or handoff, **quote verbatim or name in source language**. Never substitute the surfacer's mental model of the symptom for the source's actual framing.

## §2 Rule B — Verify framing against the running product

Source: same handoff, §F discipline lesson #9, verbatim:

> **"Verify framing against the running product, not against prior diagnostic framing."** Day-33 PM rulings session surfaced this as a third paraphrase-into-symptom-framing error: the R6/R7 amendment (PR #325) framed code defaults to "week" view; Day-33 PM operator screenshot showed MONTH active. Two prior reviewer-side framings of the same R7.2 question (Day-32 "month default" vs Day-33 AM "week default") both partial — reality (today, post-amendment) is month. The standing discipline rule is to verify against the live product when a prior diagnostic framing is the only reference point.

When a prior diagnostic framing is the only reference point for a current decision, the discipline is to verify against the live product before relying on it. The Day-33 PM rulings session caught the third R7.2 instance by reality-checking against an operator screenshot rather than re-reading PR #325's framing.

**Corrective action:** before locking a ruling that depends on a prior diagnostic, **reality-check against the running product** — screenshot, code-path read, or running query — and let that supersede the prior framing where they disagree.

## §3 How A and B relate

Both rules feed the same principle: **the running product wins over any paraphrase or stale framing of it.** Where they differ:

- **Rule A is about how you surface a known reference point.** When you cite a prior ruling, diagnostic, or memo, do so in source language. Don't compress it into a symptom.
- **Rule B is about whether to trust the reference point at all without verification.** Even a faithfully-quoted prior framing may be stale; verify against the live product before depending on it.

Rule A is necessary but not sufficient. A correctly-quoted prior framing can still be wrong if reality moved or the original framing was partial; Rule B is the verification gate.

## §4 Application

**Binds:** reviewer and builder both. Reviewer typically surfaces prior rulings as load-bearing context in §3.6 reads, reject-backs, and bootstrap briefs; builder typically inherits that framing and acts on it. Both sides are accountable.

**Fires when:** any session surfaces a prior ruling, diagnostic, memo, or framing as load-bearing context for a current decision. Most common cases: bootstrap briefs that quote §10 rulings, reject-backs that cite a prior memo's classification, plan-PR §3 surveys that lean on a prior diagnostic's enumeration, lane-open sessions that inherit a prior lane's surface enumeration.

**"Verify against the running product" means, in practice:**
- An operator screenshot of the live surface in question.
- A code-path read at a pinned SHA on `origin/main` (or production HEAD, when those diverge).
- A running query against production schema or data.

It does **not** mean re-reading prior memo text. Paraphrased memo text re-read is still paraphrased memo text — the loop the rules are designed to break.

Pick the verification form that fits the question. UI-default questions want a screenshot; code-shape questions want a pinned-SHA read; data-population questions want a running query. The discipline rule is not which form — it is that paraphrase is not a substitute for any of them.

## §5 Cross-references

- [`memory/handoffs/day-33-eod.md`](handoffs/day-33-eod.md) §F discipline lessons #1 and #9 — verbatim source.
- [PR #325](https://github.com/lovemansgit/planner/pull/325) — Calendar diagnostic R6/R7 amendment. Builder caught the Day-33 AM "month default" paraphrase by code-path read at [`consignees/[id]/page.tsx:136`](../src/app/%28app%29/consignees/%5Bid%5D/page.tsx); subsequent Day-33 PM rulings session caught the resulting "week default" framing by operator screenshot.
- [PR #331](https://github.com/lovemansgit/planner/pull/331) — Calendar-management lane rulings (R1-R10 + sub-rulings). Reality-checked R7.2 against operator screenshot showing MONTH active; locked the discipline rule into the lane's institutional record.
- **Recursive note.** This memo's own §3.6 #1 review surfaced a Rule B instance: the bootstrap brief framed today as "Day-34" by projection from prior session days, not verified against the calendar. Caught by `date -u` at §3.6 #1 (3-day numbering drift; actual today is Day-36 = 2026-05-25). Re-anchored before commit. Recursive instance of the rule the memo enforces.

# Meta

Filed Day-36 AM (2026-05-25) as a T1 docs-only PR off `origin/main` HEAD `9b9f7ba`. Single commit, single file. Branch: `docs/d36-feedback-verify-framing-against-running-product`. Worktree: `/Users/lovemans/Code/planner-d36-framing-discipline`. Self-merge authorized post-§3.6 #1 clear + CI green.
