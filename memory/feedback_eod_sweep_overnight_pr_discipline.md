---
name: EOD §B must sweep prior-day overnight (d{N}n) PRs that merge after the EOD doc is filed
description: Overnight PRs tagged `d{N}n` (Day-N night) that merge after Day-N's EOD doc is filed fall between two EOD ledgers — Day-N's §B is closed, Day-(N+1)'s author doesn't look back. Going forward, the Day-(N+1) EOD author MUST check for d{N}n merges in the AM window and sweep them into §B with a "prior-day overnight-lane work" note.
type: feedback
---

# EOD §B must sweep prior-day overnight (d{N}n) PRs that merge after the EOD doc is filed

**Surfaced:** Day 26 (14 May 2026), during the MEMORY.md Day 21–25
index reconstruction (PR #280). PR #245 (`d22n-calendar-pr-c-a`,
T3, /calendar consolidated view) was found absent from the Day-23
EOD §B PR ledger despite merging Day-23 AM Dubai (2026-05-12T06:18:14Z).

## §1 Why the seam exists

The repo uses sprint-day commit prefixes: `d22-*` for Day-22 work,
`d22n-*` for Day-22 night / overnight work, `d22-overnight-*` for
the same. Overnight lanes are typically Session A's overnight work
that bootstraps a follow-on lane the next sprint-day.

Two timing patterns produce the seam:

- **Day-N EOD doc files at Day-N PM-late.** The §B ledger captures
  every PR merged through the moment of filing.
- **A d{N}n overnight PR remains in-flight at that moment.** Session
  A's overnight work continues past EOD filing; merges happen Day-(N+1)
  AM Dubai.

The Day-(N+1) EOD author starts the new sprint-day with a fresh §B
table. They look forward — at PRs merging in their own session window —
not backward at the d{N}n merges that already landed. The d{N}n PR
falls between the two ledgers and stays unclaimed.

PR #245 is the symptom. Other instances may exist further back in
the EOD corpus; this memo establishes the rule going forward.

## §2 How to apply

When filing the Day-(N+1) EOD doc, the §B PR ledger section MUST
include a sweep step:

1. Before drafting §B, run:
   ```
   gh pr list --state=merged --search "merged:>=YYYY-MM-DDTHH:MM:SSZ"
   ```
   where the timestamp is the merge-time of the last PR in Day-N's
   §B ledger. (Alternatively, scan `git log --oneline` for `(#NNN)`
   suffixes between the Day-N EOD's main HEAD and the current main
   HEAD.)
2. Filter for `d{N}n-*`, `d{N}-overnight-*`, or other prior-day
   tagged commit messages.
3. For each match, add a row to Day-(N+1)'s §B table with:
   - **Slot column:** prefix with the tag (e.g. `AM (d22n)`) so the
     prior-day lineage is visible at a glance.
   - **Title column:** suffix with "added as prior-day overnight-lane
     continuation" or equivalent note if the original commit message
     doesn't already make the lineage obvious.

The sweep takes ~30 seconds per EOD; the cost of skipping it is a
documentation gap that gets caught months later during institutional
index reconstruction (the PR #280 case) or stays invisible forever.

## §3 What does NOT need sweeping

The rule only fires for **PRs that merge after Day-N's EOD doc is
filed**. Common false positives:

- **Bootstrap briefs filed for Day-(N+1) work that merge Day-N PM**
  (e.g. PR #241 `docs(d23-bootstrap-b)` merged Day-22 PM) belong in
  Day-N's §B by merge time, even though the commit message references
  Day-(N+1). The Day-N EOD's §B already captures these.
- **Plain `d{N}-*` PRs that merge Day-(N+1) AM** without an overnight
  tag belong in Day-(N+1) anyway — the operator just slipped the
  merge by a few hours; no special note needed.

The discriminator is the `n` / `overnight` suffix on the commit-tag
prefix, combined with the merge-time falling AFTER Day-N's EOD doc
was filed.

## §4 Retroactive fix scope

PR #281 (this commit's PR) patches Day-23 EOD §B with PR #245's row
+ files this memo. **Pre-Day-23 EOD docs are out of scope — not
audited; future audits can apply this pattern backward.** The
Day-26 MEMORY.md index reconstruction (PR #280) read Days 21–25 EOD
docs for the index-building task but did not specifically audit any
EOD's §B for `d{N}n`-seam gaps; PR #245's absence in Day-23's §B
surfaced incidentally during PR-by-PR verification of the Day-22 →
Day-23 boundary. Pre-Day-21 EOD docs were not opened during the
reconstruction at all. A future targeted audit (one EOD doc at a
time, applying the §2 sweep command against the merge-time window
between each consecutive pair of EODs) would catch any further
seam-gap instances; until that audit runs, pre-Day-23 ledgers should
not be assumed clean.
