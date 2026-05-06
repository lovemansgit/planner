// Skip-and-append algorithm tests.
//
// Implements memory/plans/day-13-exception-model-part-1.md §5.1 + §5.2.
// Source-of-truth examples and edge-case coverage are anchored to
// PLANNER_PRODUCT_BRIEF.md §3.1.6.
//
// Test layout:
//   - "worked examples" — the four canonical cases from brief §3.1.6
//   - "edge cases A–I" — the table from brief §3.1.6 + plan §5.2

import { describe, expect, it } from "vitest";

import {
  computeCompensatingDate,
  computePauseExtensionDate,
  countEligibleDeliveryDays,
  type ComputeCompensatingDateInput,
  type IsoWeekday,
  type SubscriptionForSkip,
} from "../skip-algorithm";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
//
// All worked examples use May 2026. Calendar reference (verified):
//   Mon 2026-05-04, Tue 05, Wed 06, Thu 07, Fri 08
//   Mon 2026-05-11, Tue 12, Wed 13, Thu 14, Fri 15
//   Mon 2026-05-18, Tue 19, Wed 20, Thu 21, Fri 22

const TODAY: string = "2026-05-04"; // Mon — anchor for past-date checks

function activeSub(
  endDate: string,
  daysOfWeek: readonly IsoWeekday[],
): SubscriptionForSkip {
  return { endDate, daysOfWeek, status: "active" };
}

function input(
  subscription: SubscriptionForSkip,
  skipDate: string,
  overrides: Partial<ComputeCompensatingDateInput> = {},
): ComputeCompensatingDateInput {
  return { subscription, skipDate, today: TODAY, ...overrides };
}

// -----------------------------------------------------------------------------
// §5.1 worked examples (brief §3.1.6)
// -----------------------------------------------------------------------------

describe("computeCompensatingDate — §5.1 worked examples (brief §3.1.6)", () => {
  it("case 1: Mon-Fri, end Fri 15 May, skip Wed 6 May → appended Mon 18 May", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-06"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("case 2: Mon/Wed/Fri, end Fri 15 May, skip Wed 6 May → appended Mon 18 May", () => {
    const sub = activeSub("2026-05-15", [1, 3, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-06"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("case 3: Tue/Fri, end Fri 15 May, skip Tue 5 May → appended Tue 19 May", () => {
    // Algorithm walks from 15 May +1 = Sat 16 (not Tue/Fri, skip), Sun 17,
    // Mon 18 (not Tue/Fri, skip), Tue 19 (✓ — Tue, eligible). Brief lists
    // skipDate as Tue 6 May but May 6 is a Wednesday — Tue is May 5.
    const sub = activeSub("2026-05-15", [2, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-05"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-19" });
  });

  it(
    "case 4: Mon-Fri, end Fri 15 May, double-skip Tue 5 May AND Thu 7 May " +
      "→ appended Mon 18 May AND Tue 19 May (end_date stacks to 19 May)",
    () => {
      // Stacking is service-layer behavior (each call reads the current
      // end_date and extends from there). Here the helper is called
      // sequentially with the updated end_date input.
      const subInitial = activeSub("2026-05-15", [1, 2, 3, 4, 5]);

      // First skip: Tue 5 May → end_date moves from 15 May → Mon 18 May.
      const skip1 = computeCompensatingDate(input(subInitial, "2026-05-05"));
      expect(skip1).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });

      // Second skip: Thu 7 May, with end_date now Mon 18 May → next eligible
      // walk is Tue 19 May.
      const subAfterFirst = activeSub("2026-05-18", [1, 2, 3, 4, 5]);
      const skip2 = computeCompensatingDate(input(subAfterFirst, "2026-05-07"));
      expect(skip2).toEqual({ kind: "ok", compensatingDate: "2026-05-19" });
    },
  );
});

// -----------------------------------------------------------------------------
// §5.2 edge cases A–I (brief §3.1.6)
// -----------------------------------------------------------------------------

describe("computeCompensatingDate — §5.2 edge cases (brief §3.1.6 A–I)", () => {
  it("A: compensating date lands on blackout → walks forward to next eligible", () => {
    // Mon-Fri, end Fri 15 May. skip Wed 6 May → would land on Mon 18 May,
    // but 18 May is a blackout. Algorithm walks to Tue 19 May.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", { blackoutDates: ["2026-05-18"] }),
    );
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-19" });
  });

  it("B: stacking — three sequential skips extend end_date monotonically", () => {
    // Mon-Fri, end Fri 15 May.
    // Skip Tue 5 May → end Mon 18 May.
    // Skip Wed 6 May (next call with end=18 May) → end Tue 19 May.
    // Skip Thu 7 May (next call with end=19 May) → end Wed 20 May.
    const skip1 = computeCompensatingDate(
      input(activeSub("2026-05-15", [1, 2, 3, 4, 5]), "2026-05-05"),
    );
    expect(skip1).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });

    const skip2 = computeCompensatingDate(
      input(activeSub("2026-05-18", [1, 2, 3, 4, 5]), "2026-05-06"),
    );
    expect(skip2).toEqual({ kind: "ok", compensatingDate: "2026-05-19" });

    const skip3 = computeCompensatingDate(
      input(activeSub("2026-05-19", [1, 2, 3, 4, 5]), "2026-05-07"),
    );
    expect(skip3).toEqual({ kind: "ok", compensatingDate: "2026-05-20" });
  });

  it(
    "C: idempotency / double-tap is service-layer concern; helper has no idempotency state " +
      "(documented in module header)",
    () => {
      // Two identical helper calls return the same result deterministically.
      // The DB-layer UNIQUE on (subscription_id, idempotency_key) catches
      // operator double-tap; helper itself has no notion of "this call
      // already happened."
      const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
      const a = computeCompensatingDate(input(sub, "2026-05-06"));
      const b = computeCompensatingDate(input(sub, "2026-05-06"));
      expect(a).toEqual(b);
      expect(a).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
    },
  );

  it("D: max_skips cap rejects when existing_skip_count >= cap", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", {
        maxSkipsPerSubscription: 3,
        existingSkipCount: 3,
      }),
    );
    expect(result).toEqual({ kind: "rejected", reason: "max_skips_exceeded" });
  });

  it("D: max_skips cap allows when existing_skip_count < cap", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", {
        maxSkipsPerSubscription: 3,
        existingSkipCount: 2,
      }),
    );
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("E: skip near original end_date — tail-end semantic still applies", () => {
    // Mon-Fri ending Fri 15 May; skip Fri 15 May (the very last delivery
    // before end_date). Next eligible walk: Sat 16 (skip), Sun 17 (skip),
    // Mon 18 (eligible). end_date extends by one slot.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-15"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("F: paused subscription rejects skip", () => {
    const sub: SubscriptionForSkip = {
      endDate: "2026-05-15",
      daysOfWeek: [1, 2, 3, 4, 5],
      status: "paused",
    };
    const result = computeCompensatingDate(input(sub, "2026-05-06"));
    expect(result).toEqual({ kind: "rejected", reason: "subscription_not_active" });
  });

  it("F: ended subscription rejects skip", () => {
    const sub: SubscriptionForSkip = {
      endDate: "2026-05-15",
      daysOfWeek: [1, 2, 3, 4, 5],
      status: "ended",
    };
    const result = computeCompensatingDate(input(sub, "2026-05-06"));
    expect(result).toEqual({ kind: "rejected", reason: "subscription_not_active" });
  });

  it("G: past-date skip rejects", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    // today is Mon 2026-05-04; skip on Fri 2026-05-01 is in the past.
    const result = computeCompensatingDate(input(sub, "2026-05-01"));
    expect(result).toEqual({ kind: "rejected", reason: "past_date" });
  });

  it("G: same-day skip is not 'past' — boundary case", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    // today is Mon 2026-05-04; skip on Mon 2026-05-04 should pass the
    // past-date guard and land on the next eligible day after end_date.
    const result = computeCompensatingDate(input(sub, "2026-05-04"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("H: skip on the very last delivery extends end_date by exactly one slot", () => {
    // Same as case-1 but framed for the last-delivery edge.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-15"));
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-18" });
  });

  it("I: multi-task date — helper operates per-subscription (MVP not relevant)", () => {
    // MVP invariant: 1 sub = 1 task per delivery date. The helper has no
    // notion of multiple tasks; it operates on the subscription's
    // (endDate, daysOfWeek) shape. This test pins the invariant: two
    // independent skip calls on the same date for the same sub yield the
    // same result regardless of any "multi-task" notion at the service
    // layer.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const a = computeCompensatingDate(input(sub, "2026-05-06"));
    const b = computeCompensatingDate(input(sub, "2026-05-06"));
    expect(a).toEqual(b);
  });

  it("rejects skip on weekday that's not in days_of_week", () => {
    // Mon-Fri sub, skip Sat 9 May — Sat (weekday 6) is not in [1..5].
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(input(sub, "2026-05-09"));
    expect(result).toEqual({
      kind: "rejected",
      reason: "skip_date_not_eligible_weekday",
    });
  });

  it("rejects skip on a blackout date", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", { blackoutDates: ["2026-05-06"] }),
    );
    expect(result).toEqual({ kind: "rejected", reason: "skip_date_in_blackout" });
  });

  it("rejects skip date that falls inside a pause window", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", {
        pauseWindows: [{ start: "2026-05-04", end: "2026-05-08" }],
      }),
    );
    expect(result).toEqual({ kind: "rejected", reason: "skip_date_in_pause_window" });
  });

  it("walks past pause window when computing compensating date", () => {
    // Mon-Fri, end Fri 15 May. Pause Sat 16 → Tue 19 covers what would
    // be Mon 18. Algorithm walks: 16 (Sat → not eligible), 17 (Sun →
    // not eligible), 18 (Mon → eligible BUT in pause), 19 (Tue → eligible
    // BUT in pause), 20 (Wed → eligible, not in pause).
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computeCompensatingDate(
      input(sub, "2026-05-06", {
        pauseWindows: [{ start: "2026-05-16", end: "2026-05-19" }],
      }),
    );
    expect(result).toEqual({ kind: "ok", compensatingDate: "2026-05-20" });
  });

  it("safety stop: returns no_compensating_date_found when daysOfWeek + blackouts make 365+ days unreachable", () => {
    // Pathological input: daysOfWeek=[1] (Mon-only), and every Monday for
    // the next 400 days is in blackouts. The walk exhausts MAX_FORWARD_DAYS
    // and rejects.
    const sub = activeSub("2026-05-15", [1]);
    // Generate 60 consecutive Mondays starting from Mon 18 May 2026.
    // 60 weeks > 400 days but actually 60*7 = 420 — covers the safety
    // window. We build the blackout list manually for clarity.
    const blackouts: string[] = [];
    const cursor = new Date("2026-05-18T00:00:00.000Z");
    for (let i = 0; i < 60; i++) {
      blackouts.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    const result = computeCompensatingDate(input(sub, "2026-05-11", { blackoutDates: blackouts }));
    expect(result).toEqual({
      kind: "rejected",
      reason: "no_compensating_date_found",
    });
  });
});

// -----------------------------------------------------------------------------
// §5.3 computePauseExtensionDate — Day-16 Block 4-C Service B helper
// -----------------------------------------------------------------------------

describe("computePauseExtensionDate — brief §3.1.7 worked examples", () => {
  it("Mon-Fri sub, end_date Fri 2026-05-15, extension 5 days → next Fri 2026-05-22", () => {
    // Brief §3.1.7 worked example: pause covers entire week Mon-Fri (5
    // eligible days). Walk forward 5 eligible weekdays from Sat
    // 2026-05-16 (currentEndDate + 1) → Mon, Tue, Wed, Thu, Fri = Fri
    // 2026-05-22.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 5,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-22" });
  });

  it("Mon/Wed/Fri sub, end_date Fri 2026-05-15, extension 3 days → Fri 2026-05-22", () => {
    // 3 eligible weekdays in pause week Mon-Fri (Mon, Wed, Fri). Walk
    // 3 eligible from 2026-05-16: Mon 2026-05-18, Wed 2026-05-20, Fri
    // 2026-05-22.
    const sub = activeSub("2026-05-15", [1, 3, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 3,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-22" });
  });

  it("Tue/Fri sub, end_date Fri 2026-05-15, extension 2 days → Fri 2026-05-22", () => {
    const sub = activeSub("2026-05-15", [2, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 2,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-22" });
  });

  it("extension_days=0 returns currentEndDate unchanged", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 0,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-15" });
  });

  it("extension_days=1 returns the next eligible weekday", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]); // ends Fri
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 1,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-18" }); // Mon
  });

  it("multi-week extension: Mon-Fri sub, extension 10 days → 10th eligible weekday past end", () => {
    // Mon-Fri = 5 eligible per week. 10 days = 2 weeks. End Fri
    // 2026-05-15 + 10 eligible Mon-Fri = Fri 2026-05-29.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 10,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-29" });
  });

  it("pause window overlapping the walk: skips overlap, lands past it", () => {
    // Sub Mon-Fri ends Fri 2026-05-15. Extension 3 days. Existing
    // future pause window covers Mon-Fri 2026-05-18..2026-05-22 (the
    // first eligible week post-end). Walk should skip those 5 days
    // and land in the following week.
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 3,
      pauseWindows: [{ start: "2026-05-18", end: "2026-05-22" }],
    });
    // First eligible weekday post-pause-window is Mon 2026-05-25.
    // Walk: Mon 2026-05-25 (1), Tue 2026-05-26 (2), Wed 2026-05-27 (3).
    expect(result).toEqual({ kind: "ok", newEndDate: "2026-05-27" });
  });

  it("rejects when daysOfWeek is empty", () => {
    const sub: SubscriptionForSkip = {
      endDate: "2026-05-15",
      daysOfWeek: [],
      status: "active",
    };
    const result = computePauseExtensionDate({
      subscription: sub,
      currentEndDate: "2026-05-15",
      extensionDays: 3,
      pauseWindows: [],
    });
    expect(result).toEqual({ kind: "rejected", reason: "no_extension_date_found" });
  });

  it("throws on negative extensionDays (programming error)", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(() =>
      computePauseExtensionDate({
        subscription: sub,
        currentEndDate: "2026-05-15",
        extensionDays: -1,
        pauseWindows: [],
      }),
    ).toThrow(/extensionDays must be >= 0/);
  });
});

describe("countEligibleDeliveryDays", () => {
  it("Mon-Fri sub, pause Mon-Fri week → 5", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-04", "2026-05-08")).toBe(5);
  });

  it("Mon-Fri sub, pause Sat-Sun (no eligible days) → 0", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-09", "2026-05-10")).toBe(0);
  });

  it("Mon/Wed/Fri sub, pause Mon-Fri week → 3", () => {
    const sub = activeSub("2026-05-15", [1, 3, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-04", "2026-05-08")).toBe(3);
  });

  it("single-day pause on eligible weekday → 1", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-06", "2026-05-06")).toBe(1);
  });

  it("single-day pause on non-eligible weekday → 0", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]); // Mon-Fri
    expect(countEligibleDeliveryDays(sub, "2026-05-09", "2026-05-09")).toBe(0); // Sat
  });

  it("two-week pause Mon-Fri sub → 10", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-04", "2026-05-15")).toBe(10);
  });

  it("inverted range (end before start) → 0", () => {
    const sub = activeSub("2026-05-15", [1, 2, 3, 4, 5]);
    expect(countEligibleDeliveryDays(sub, "2026-05-08", "2026-05-04")).toBe(0);
  });

  it("empty daysOfWeek → 0", () => {
    const sub: SubscriptionForSkip = {
      endDate: "2026-05-15",
      daysOfWeek: [],
      status: "active",
    };
    expect(countEligibleDeliveryDays(sub, "2026-05-04", "2026-05-08")).toBe(0);
  });
});
