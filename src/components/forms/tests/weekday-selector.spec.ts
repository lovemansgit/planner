// Day-22 Phase 1 forms — WeekdaySelector helper unit tests.
//
// Pure helper coverage parity with PR #229 baseline (helper-only
// tests; full JSX render tests deferred to client-component test
// infrastructure per memory/followup_client_component_test_infra.md).
// Covers parse + serialise round-trip + defensive filtering on bad
// FormData input (hand-crafted POST / name= collision).

import { describe, expect, it } from "vitest";

import {
  parseSelectedWeekdays,
  weekdaysToIsoOrdinals,
} from "../WeekdaySelector";

describe("parseSelectedWeekdays", () => {
  it("returns empty for empty input", () => {
    expect(parseSelectedWeekdays([])).toEqual([]);
  });

  it("preserves all 7 valid keys in ISO order", () => {
    const input = ["fri", "sun", "mon", "wed", "tue", "thu", "sat"];
    expect(parseSelectedWeekdays(input)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]);
  });

  it("deduplicates repeated keys", () => {
    expect(parseSelectedWeekdays(["mon", "mon", "wed", "wed"])).toEqual(["mon", "wed"]);
  });

  it("drops invalid string values defensively", () => {
    expect(parseSelectedWeekdays(["mon", "monday", "Sun", "sun"])).toEqual([
      "mon",
      "sun",
    ]);
  });

  it("drops non-string values defensively", () => {
    expect(parseSelectedWeekdays([1, null, undefined, "wed", { day: "thu" }])).toEqual([
      "wed",
    ]);
  });
});

describe("weekdaysToIsoOrdinals", () => {
  it("maps weekday keys to ISO ordinals (Mon=1...Sun=7)", () => {
    expect(weekdaysToIsoOrdinals(["mon", "wed", "fri"])).toEqual([1, 3, 5]);
  });

  it("preserves ISO ordering regardless of input order", () => {
    expect(weekdaysToIsoOrdinals(["sun", "mon"])).toEqual([1, 7]);
  });

  it("returns empty for empty input", () => {
    expect(weekdaysToIsoOrdinals([])).toEqual([]);
  });

  it("handles all 7 days", () => {
    expect(
      weekdaysToIsoOrdinals(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
