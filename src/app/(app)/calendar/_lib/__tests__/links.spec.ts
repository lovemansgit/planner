// Day-22n PR-C-B — Spec for the drill-down link helpers. Pure-fn
// coverage per the codebase's no-render-test convention
// (memory/followup_client_component_test_infra.md).

import { describe, expect, it } from "vitest";

import { linkToConsigneeCalendar, mondayOf } from "../links";

describe("mondayOf", () => {
  it("returns the same date when given a Monday", () => {
    expect(mondayOf("2026-05-11")).toBe("2026-05-11"); // Mon
  });
  it("rolls back to Monday from Tuesday", () => {
    expect(mondayOf("2026-05-12")).toBe("2026-05-11");
  });
  it("rolls back to Monday from Friday", () => {
    expect(mondayOf("2026-05-15")).toBe("2026-05-11");
  });
  it("rolls back to previous Monday from Sunday", () => {
    expect(mondayOf("2026-05-17")).toBe("2026-05-11");
  });
  it("crosses month boundary", () => {
    expect(mondayOf("2026-06-02")).toBe("2026-06-01"); // Tue→Mon, same month
    expect(mondayOf("2026-06-01")).toBe("2026-06-01"); // Mon
    expect(mondayOf("2026-04-01")).toBe("2026-03-30"); // Wed→prev Mon, crosses month
  });
  it("crosses year boundary", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // Fri 2027-01-01 → Mon 2026-12-28
  });
  it("handles leap-year Feb 29", () => {
    expect(mondayOf("2028-02-29")).toBe("2028-02-28"); // Tue→Mon
  });
});

describe("linkToConsigneeCalendar", () => {
  it("returns the consignee detail calendar URL with the week anchor", () => {
    expect(linkToConsigneeCalendar("c_001", "2026-05-15")).toBe(
      "/consignees/c_001?tab=calendar&week=2026-05-11",
    );
  });
  it("preserves the consignee id verbatim (no encoding mangling)", () => {
    expect(linkToConsigneeCalendar("c_abc-123", "2026-05-12")).toBe(
      "/consignees/c_abc-123?tab=calendar&week=2026-05-11",
    );
  });
  it("anchors to the same Monday for any day within the same week", () => {
    const monday = linkToConsigneeCalendar("c_001", "2026-05-11");
    const friday = linkToConsigneeCalendar("c_001", "2026-05-15");
    const sunday = linkToConsigneeCalendar("c_001", "2026-05-17");
    expect(monday).toBe(friday);
    expect(friday).toBe(sunday);
  });
});
