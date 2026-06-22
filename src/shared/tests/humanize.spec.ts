// Phase 9 Step 3.1 (Foundations) — humanise layer tests (Gap J / D4).
// RED-first: exact expected outputs pinned before implementation.
// These are pure additive utilities; they do not by themselves restyle any
// screen (adoption is later bundles).

import { describe, expect, it } from "vitest";

import { CONSIGNEE, formatPhone, statusLabel, toTitleCase } from "@/shared/humanize";

describe("formatPhone — UAE-first display formatter (inbound counterpart: normaliseToE164)", () => {
  it("groups a UAE mobile E.164 number", () => {
    expect(formatPhone("+971501234567")).toBe("+971 50 123 4567");
  });
  it("groups a UAE landline E.164 number", () => {
    expect(formatPhone("+97141234567")).toBe("+971 4 123 4567");
  });
  it("returns non-UAE numbers unchanged (UAE-first; libphonenumber swap deferred)", () => {
    expect(formatPhone("+12025550123")).toBe("+12025550123");
  });
  it("returns unrecognised input unchanged — a display formatter never throws", () => {
    expect(formatPhone("not a phone")).toBe("not a phone");
    expect(formatPhone("")).toBe("");
  });
});

describe("statusLabel — generic enum humaniser (no task-status vocabulary; the fast-follow lane owns task rendering)", () => {
  it("title-cases single-word statuses", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("paused")).toBe("Paused");
    expect(statusLabel("ended")).toBe("Ended");
    expect(statusLabel("unresolved")).toBe("Unresolved");
  });
  it("splits snake_case into words", () => {
    expect(statusLabel("at_risk")).toBe("At Risk");
    expect(statusLabel("on_hold")).toBe("On Hold");
  });
  it("normalises SCREAMING_CASE", () => {
    expect(statusLabel("ASSIGNED")).toBe("Assigned");
  });
  it("returns empty string for empty input", () => {
    expect(statusLabel("")).toBe("");
  });
});

describe("toTitleCase — shared kebab/snake humaniser", () => {
  it("humanises kebab and snake casing", () => {
    expect(toTitleCase("tenant-admin")).toBe("Tenant Admin");
    expect(toTitleCase("on_hold")).toBe("On Hold");
  });
});

describe("CONSIGNEE — canonical entity noun (D4: retire 'subscriber' / 'merchant subscriber')", () => {
  it("is 'consignee' / 'consignees', never 'subscriber'", () => {
    expect(CONSIGNEE.one).toBe("consignee");
    expect(CONSIGNEE.many).toBe("consignees");
    expect(CONSIGNEE.Title).toBe("Consignee");
    expect(CONSIGNEE.TitleMany).toBe("Consignees");
    expect(Object.values(CONSIGNEE)).not.toContain("subscriber");
  });
});
