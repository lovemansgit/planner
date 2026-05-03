# Decision · Daily task-generation cutoff, window, and SuiteFleet push throughput

**Status:** Decided. Captured 28 April 2026 (Day 3 EOD review).
**Decided by:** Love (engineering-owner), confirming Transcorp operational rules.
**Triggered by:** Operations team question — "are we generating all subscription meals immediately for the full subscription period, or for the following day only? And if at cutoff, are we considering API rate limits?"

## Decisions locked

| Decision | Value |
|---|---|
| Cutoff time (Asia/Dubai) | **17:00** |
| Task-generation window | **16:00 – 17:00** (1 hour) |
| Push horizon | Next-day only — never multi-day batch push |
| Push API | Single `createTask` per task at 5 req/sec |
| Bulk endpoint (`createBulk`) | Not used in MVP; revisit if volumes exceed ~9,000 tasks/day |
| Meal-plan daily volume cap | 7,000 tasks/day (max — small slice of Transcorp's 50K total) |
| Rate-limit assumption | 5 req/sec (conservative; awaiting SuiteFleet confirmation) |

## Why next-day push, not full-period

Three reasons, ranked by importance:

1. **SuiteFleet's 14-day rolling task horizon is a Transcorp operational rule** (Day 2 architecture). Pushing 90 days of tasks at subscription creation would dump 90 days of pending work into SuiteFleet's planning UI, drown the dispatch team, break every report.
2. **Editability window.** Holding tasks in our DB until T-1 day means every skip/append before cutoff is a free in-DB update — no SuiteFleet round-trip, no churn against `cancelTask + replacement`.
3. **State drift.** Consignees move, subscriptions get paused, addresses change. Tasks generated at T-1 day reflect the latest known truth.

## Throughput math

At 7,000 tasks/day and 5 req/sec:

```
7,000 tasks ÷ 5 req/sec = 1,400 seconds = 23 min 20 sec
```

Fits inside the 60-minute 16:00–17:00 window with substantial headroom.

Headroom utilisation: ~39%. If transient SuiteFleet hiccups consume retry time, the window still completes by 17:00.

## Open follow-up — SuiteFleet rate-limit confirmation

Awaiting written confirmation from SuiteFleet on the real rate-limit ceiling. The 5 req/sec figure is conservative operational guidance, not a documented SLA. If real ceiling is 8–10 req/sec, the window is half-utilised. If real ceiling is 5 req/sec hard, current sizing is correct.

This question is part of the broader pre-Day-14 communication to SuiteFleet that already covers:
- Written rate-limit doc
- Error-code catalogue
- Webhook retry policy (count, interval, eventual-drop behaviour)
- Whether `createBulk` has different rate-limit treatment

## Onboarding doc microcopy fixes (v1.2)

The current `subscription-planner-onboarding_v1.1.pdf` references 20:00 / 20:05 in several places. All references must change to 17:00:

| Location | Current text | New text |
|---|---|---|
| Page 26 — migration import ready state | "tasks will generate at the next 20:05 cut-off" | "tasks will generate at the next 17:00 cut-off" |
| Page 27 — validation passed state | "Push tomorrow's tasks to SuiteFleet at 20:05 today" | "Push tomorrow's tasks to SuiteFleet at 17:00 today" |
| Page 29 — ongoing import explainer | "the next 20:05 cut-off" | "the next 17:00 cut-off" |
| Page 30 — ongoing import complete | "the next 20:05 cut-off" | "the next 17:00 cut-off" |
| Page 38 — microcopy reference, "Cut-off time" tooltip | "default 20:00 Asia/Dubai" | "default 17:00 Asia/Dubai" |

## Engineering implications

- **Day 7+ task-generation cron** runs at 16:00 Asia/Dubai, completes by 17:00. Single-task `createTask` calls through the adapter, throttled at 5 req/sec.
- **Day 8 `createTask` adapter method** ships single-task API for both day-to-day skip/append AND the nightly cutoff job — no separate bulk path needed for MVP.
- **`createBulk` adapter method** parked as a future commit, triggered if volumes exceed ~9,000 tasks/day or if SuiteFleet confirms a stricter rate-limit than 5 req/sec.
- The 16:00–17:00 window is the merchant-facing deadline. Edits after 17:00 affect only the day-after-tomorrow's tasks, not tomorrow's.
