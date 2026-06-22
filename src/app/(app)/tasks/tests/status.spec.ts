// Day 11 / P5 — tests for the URL-param parsers + status filter list.

import { describe, expect, it } from "vitest";

import { COURIER_STATUS_VALUES } from "@/modules/integration/types";
import type { TaskInternalStatus } from "@/modules/tasks/types";

import {
  ALLOWED_PAGE_SIZES,
  COURIER_STATUS_DISPLAY,
  COURIER_STATUS_FILTER_OPTIONS,
  PAGE_SIZE,
  PAGE_SIZE_DEFAULT,
  parseCourierStatusParam,
  parsePageParam,
  parsePerPageParam,
  resolveCourierDisplay,
} from "../status";

describe("parsePageParam", () => {
  it("parses positive integers", () => {
    expect(parsePageParam("1")).toBe(1);
    expect(parsePageParam("42")).toBe(42);
  });

  it("falls back to 1 for missing / invalid / non-positive input", () => {
    expect(parsePageParam(undefined)).toBe(1);
    expect(parsePageParam("")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-3")).toBe(1);
  });

  it("returns 1 for array params (rejects ?page=1&page=2)", () => {
    expect(parsePageParam(["2"])).toBe(1);
  });
});

describe("PAGE_SIZE", () => {
  it("is a sensible page size for pilot scale", () => {
    expect(PAGE_SIZE).toBeGreaterThan(10);
    expect(PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it("is the same value as PAGE_SIZE_DEFAULT (back-compat alias)", () => {
    expect(PAGE_SIZE).toBe(PAGE_SIZE_DEFAULT);
  });
});

describe("ALLOWED_PAGE_SIZES catalogue", () => {
  it("starts at the default and is sorted ascending", () => {
    expect(ALLOWED_PAGE_SIZES[0]).toBe(PAGE_SIZE_DEFAULT);
    const sorted = [...ALLOWED_PAGE_SIZES].sort((a, b) => a - b);
    expect([...ALLOWED_PAGE_SIZES]).toEqual(sorted);
  });

  it("includes 500 (matches the SF label-cap empirical bound)", () => {
    expect(ALLOWED_PAGE_SIZES).toContain(500);
  });
});

describe("parsePerPageParam", () => {
  it("returns the value verbatim when it's an allowed size", () => {
    expect(parsePerPageParam("50")).toBe(50);
    expect(parsePerPageParam("100")).toBe(100);
    expect(parsePerPageParam("300")).toBe(300);
    expect(parsePerPageParam("500")).toBe(500);
  });

  it("clamps to the default for unknown / invalid / malformed values", () => {
    // Unknown numeric values fall back rather than 4xxing the operator.
    expect(parsePerPageParam("75")).toBe(PAGE_SIZE_DEFAULT);
    expect(parsePerPageParam("0")).toBe(PAGE_SIZE_DEFAULT);
    expect(parsePerPageParam("-1")).toBe(PAGE_SIZE_DEFAULT);
    expect(parsePerPageParam("abc")).toBe(PAGE_SIZE_DEFAULT);
    expect(parsePerPageParam("")).toBe(PAGE_SIZE_DEFAULT);
  });

  it("clamps to the default for missing / array params", () => {
    expect(parsePerPageParam(undefined)).toBe(PAGE_SIZE_DEFAULT);
    expect(parsePerPageParam(["100"])).toBe(PAGE_SIZE_DEFAULT);
  });
});

// =============================================================================
// D56 Phase 8 / Lane 3 — fine courier_status render maps + filter
//
// The operator surfaces render the fine SuiteFleet courier state (14 values)
// distinctly via colour-family + icon + label (brief v1.31 §3.1.10 + §3.3.11;
// plan §3 table). NO new hex — every pill colour is a brand token from
// §3.3.11 (tailwind.config.ts / brand-tokens.css). NULL falls back to the
// coarse internal_status render so pre-backfill / Planner-only rows are
// unchanged.
// =============================================================================

// Brand tokens defined in tailwind.config.ts → brand-tokens.css §3.3.11.
// A fine pill class may only reference colours from this set — the lane's
// "NO NEW HEX, all from §3.3.11" guard, expressed at the token layer so a
// typo'd or invented colour name is caught, not just a raw hex literal.
const KNOWN_BRAND_COLORS: ReadonlySet<string> = new Set([
  "navy",
  "green",
  "amber",
  "amber-100",
  "amber-300",
  "amber-600",
  "amber-deep",
  "red",
  "ocean-blue",
  "paper",
  "ivory",
  "stone-200",
  "stone-600",
  "ink",
  "surface-primary",
  "surface-secondary",
]);

/** Extract the colour name from each bg-/text-/border-/ring- utility (sans /alpha). */
function colorTokens(pillClass: string): readonly string[] {
  return pillClass
    .split(/\s+/)
    .map((cls) => cls.match(/^(?:bg|text|border|ring)-([a-z0-9-]+?)(?:\/\d+)?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1]);
}

describe("COURIER_STATUS_DISPLAY catalogue", () => {
  it("has an entry for every fine courier_status value, in canonical order", () => {
    // Mirrors COURIER_STATUS_VALUES (the integration enum + 0035 CHECK).
    expect(Object.keys(COURIER_STATUS_DISPLAY)).toEqual([...COURIER_STATUS_VALUES]);
  });

  it("gives each state a non-empty operator label", () => {
    for (const value of COURIER_STATUS_VALUES) {
      expect(COURIER_STATUS_DISPLAY[value].label.length).toBeGreaterThan(0);
    }
  });

  it("renders the Love-ruled labels verbatim", () => {
    expect(COURIER_STATUS_DISPLAY.ORDERED.label).toBe("Ordered");
    expect(COURIER_STATUS_DISPLAY.ASSIGNED.label).toBe("Driver assigned");
    expect(COURIER_STATUS_DISPLAY.PICKED_UP.label).toBe("Picked up");
    // Love's term — DC = Distribution Centre; internal value unchanged.
    expect(COURIER_STATUS_DISPLAY.ARRIVED_AT_DC.label).toBe("Arrived in DC");
    expect(COURIER_STATUS_DISPLAY.IN_TRANSIT.label).toBe("In transit");
    expect(COURIER_STATUS_DISPLAY.HUB_TRANSFER.label).toBe("Hub transfer");
    expect(COURIER_STATUS_DISPLAY.OUT_FOR_DELIVERY.label).toBe("Out for delivery");
    expect(COURIER_STATUS_DISPLAY.DELIVERED.label).toBe("Delivered");
    expect(COURIER_STATUS_DISPLAY.FAILED.label).toBe("Delivery failed");
    expect(COURIER_STATUS_DISPLAY.PROCESS_FOR_RETURN.label).toBe("Processing return");
    expect(COURIER_STATUS_DISPLAY.RETURNED_TO_SHIPPER.label).toBe("Returned to shipper");
    expect(COURIER_STATUS_DISPLAY.CANCELED.label).toBe("Cancelled");
    expect(COURIER_STATUS_DISPLAY.RESCHEDULED.label).toBe("Rescheduled");
    expect(COURIER_STATUS_DISPLAY.REATTEMPT.label).toBe("Reattempt scheduled");
  });

  it("assigns the correct icon key per state (incl. CANCELED null-glyph + Return variants)", () => {
    expect(COURIER_STATUS_DISPLAY.ORDERED.iconKey).toBe("package");
    expect(COURIER_STATUS_DISPLAY.ASSIGNED.iconKey).toBe("van");
    expect(COURIER_STATUS_DISPLAY.PICKED_UP.iconKey).toBe("pickup");
    expect(COURIER_STATUS_DISPLAY.ARRIVED_AT_DC.iconKey).toBe("dc");
    expect(COURIER_STATUS_DISPLAY.IN_TRANSIT.iconKey).toBe("truck");
    expect(COURIER_STATUS_DISPLAY.HUB_TRANSFER.iconKey).toBe("hub");
    expect(COURIER_STATUS_DISPLAY.OUT_FOR_DELIVERY.iconKey).toBe("ofd");
    expect(COURIER_STATUS_DISPLAY.DELIVERED.iconKey).toBe("pod");
    expect(COURIER_STATUS_DISPLAY.FAILED.iconKey).toBe("caution");
    expect(COURIER_STATUS_DISPLAY.PROCESS_FOR_RETURN.iconKey).toBe("return-outline");
    expect(COURIER_STATUS_DISPLAY.RETURNED_TO_SHIPPER.iconKey).toBe("return-solid");
    expect(COURIER_STATUS_DISPLAY.CANCELED.iconKey).toBeNull();
    expect(COURIER_STATUS_DISPLAY.RESCHEDULED.iconKey).toBe("reschedule");
    expect(COURIER_STATUS_DISPLAY.REATTEMPT.iconKey).toBe("retry");
  });

  it("groups colours by family (Love's enumeration ruling)", () => {
    // Info — Ocean Blue (ASSIGNED gets its own family; frees amber for the ramp).
    expect(COURIER_STATUS_DISPLAY.ASSIGNED.pillClass).toContain("ocean-blue");
    // Amber ramp — journey deepening; OUT_FOR_DELIVERY on the hi-vis CORE
    // Signal Amber (`bg-amber`, solid), Love-locked as highest-attention.
    expect(COURIER_STATUS_DISPLAY.PICKED_UP.pillClass).toContain("amber-100");
    expect(COURIER_STATUS_DISPLAY.ARRIVED_AT_DC.pillClass).toContain("amber-300");
    expect(COURIER_STATUS_DISPLAY.IN_TRANSIT.pillClass).toContain("amber-600");
    expect(COURIER_STATUS_DISPLAY.HUB_TRANSFER.pillClass).toContain("amber-deep");
    expect(COURIER_STATUS_DISPLAY.OUT_FOR_DELIVERY.pillClass).toMatch(/\bbg-amber\b/);
    // Success — Grass Green.
    expect(COURIER_STATUS_DISPLAY.DELIVERED.pillClass).toContain("green");
    // Alarm — Bright Red (failure family, disambiguated by icon+label).
    expect(COURIER_STATUS_DISPLAY.FAILED.pillClass).toContain("red");
    expect(COURIER_STATUS_DISPLAY.PROCESS_FOR_RETURN.pillClass).toContain("red");
    expect(COURIER_STATUS_DISPLAY.RETURNED_TO_SHIPPER.pillClass).toContain("red");
    // Hold — Stone 600 on Ivory (the RESCHEDULED/REATTEMPT pair).
    expect(COURIER_STATUS_DISPLAY.RESCHEDULED.pillClass).toContain("ivory");
    expect(COURIER_STATUS_DISPLAY.RESCHEDULED.pillClass).toContain("stone-600");
    expect(COURIER_STATUS_DISPLAY.REATTEMPT.pillClass).toContain("ivory");
    expect(COURIER_STATUS_DISPLAY.REATTEMPT.pillClass).toContain("stone-600");
    // Neutral — Stone (ORDERED) + CANCELED line-through.
    expect(COURIER_STATUS_DISPLAY.ORDERED.pillClass).toContain("stone");
    expect(COURIER_STATUS_DISPLAY.CANCELED.pillClass).toContain("line-through");
  });

  it("uses NO new hex — every pill colour is a §3.3.11 brand token", () => {
    for (const value of COURIER_STATUS_VALUES) {
      const pill = COURIER_STATUS_DISPLAY[value].pillClass;
      expect(pill).not.toContain("#"); // no raw hex literal
      for (const color of colorTokens(pill)) {
        expect(KNOWN_BRAND_COLORS.has(color)).toBe(true);
      }
    }
  });
});

describe("COURIER_STATUS_FILTER_OPTIONS", () => {
  it("lists the 14 fine states then CREATED + SKIPPED; ON_HOLD is excluded (D57 Item B)", () => {
    expect(COURIER_STATUS_FILTER_OPTIONS.map((o) => o.value)).toEqual([
      ...COURIER_STATUS_VALUES,
      "CREATED",
      "SKIPPED",
    ]);
    // No "On hold" option (and no invented "Retry"/"Awaiting").
    expect(COURIER_STATUS_FILTER_OPTIONS.map((o) => o.value)).not.toContain("ON_HOLD");
  });

  it("derives fine labels from the display map; CREATED/SKIPPED get plain labels", () => {
    const byValue = new Map(COURIER_STATUS_FILTER_OPTIONS.map((o) => [o.value, o.label]));
    expect(byValue.get("DELIVERED")).toBe(COURIER_STATUS_DISPLAY.DELIVERED.label);
    expect(byValue.get("OUT_FOR_DELIVERY")).toBe(COURIER_STATUS_DISPLAY.OUT_FOR_DELIVERY.label);
    expect(byValue.get("CREATED")).toBe("Created");
    expect(byValue.get("SKIPPED")).toBe("Skipped");
  });
});

describe("parseCourierStatusParam", () => {
  it("round-trips every fine courier_status value", () => {
    for (const value of COURIER_STATUS_VALUES) {
      expect(parseCourierStatusParam(value)).toBe(value);
    }
  });

  it("accepts the coarse-only states with real rows (CREATED, SKIPPED) — D57 Item B", () => {
    expect(parseCourierStatusParam("CREATED")).toBe("CREATED");
    expect(parseCourierStatusParam("SKIPPED")).toBe("SKIPPED");
  });

  it("recognises ON_HOLD so a hand-typed filter returns nothing (not All) — D57 Item C", () => {
    // ON_HOLD is a valid filter value (the predicate matches no row) even though
    // it is NOT a dropdown option — a legacy ?status=ON_HOLD must filter to 0,
    // not silently degrade to the All view (which undefined would cause).
    expect(parseCourierStatusParam("ON_HOLD")).toBe("ON_HOLD");
  });

  it("returns undefined for unknown / mis-cased / empty / missing / array params", () => {
    expect(parseCourierStatusParam("OUT_FOR_DELIVERY_SOON")).toBeUndefined();
    expect(parseCourierStatusParam("out_for_delivery")).toBeUndefined();
    expect(parseCourierStatusParam("")).toBeUndefined();
    expect(parseCourierStatusParam(undefined)).toBeUndefined();
    expect(parseCourierStatusParam(["DELIVERED"])).toBeUndefined();
  });

  it("accepts the spellings that overlap with coarse statuses (still valid fine)", () => {
    expect(parseCourierStatusParam("IN_TRANSIT")).toBe("IN_TRANSIT");
    expect(parseCourierStatusParam("DELIVERED")).toBe("DELIVERED");
    expect(parseCourierStatusParam("CANCELED")).toBe("CANCELED");
  });
});

describe("resolveCourierDisplay", () => {
  it("renders the FINE state when courier_status is present", () => {
    // OUT_FOR_DELIVERY and IN_TRANSIT share coarse IN_TRANSIT — the fine
    // field must win so the two render distinctly (the headline A2 case).
    const ofd = resolveCourierDisplay("OUT_FOR_DELIVERY", "IN_TRANSIT");
    expect(ofd.label).toBe("Out for delivery");
    expect(ofd.iconKey).toBe("ofd");
    expect(ofd.pillClass).toMatch(/\bbg-amber\b/);
  });

  it("falls back to the coarse internal_status map when courier_status is NULL", () => {
    const transit = resolveCourierDisplay(null, "IN_TRANSIT");
    expect(transit.label).toBe("In transit");
    expect(transit.iconKey).toBe("truck");

    const delivered = resolveCourierDisplay(null, "DELIVERED");
    expect(delivered.label).toBe("Delivered");
    expect(delivered.iconKey).toBe("pod");

    const created = resolveCourierDisplay(null, "CREATED");
    expect(created.label).toBe("Created");
    expect(created.iconKey).toBe("package");
  });

  it("keeps the null-glyph behaviour for cancelled / on-hold / skipped", () => {
    expect(resolveCourierDisplay("CANCELED", "CANCELED").iconKey).toBeNull();
    expect(resolveCourierDisplay("CANCELED", "CANCELED").pillClass).toContain("line-through");
    expect(resolveCourierDisplay(null, "CANCELED").iconKey).toBeNull();
    expect(resolveCourierDisplay(null, "ON_HOLD").iconKey).toBeNull();
    expect(resolveCourierDisplay(null, "SKIPPED").iconKey).toBeNull();
  });

  it("renders ON_HOLD legacy rows label-neutral — no status word (D57 Item C)", () => {
    const onHold = resolveCourierDisplay(null, "ON_HOLD");
    expect(onHold.label).toBe("—");
    // No "On hold" word, no invented "Retry"/"Awaiting" — minimal honest pill.
    expect(onHold.label).not.toMatch(/hold|retry|awaiting/i);
    expect(onHold.iconKey).toBeNull();
  });

  it("coarse fallback preserves the legacy per-status render (no regression)", () => {
    // The legacy coarse pill catalogue (retired TASK_STATUS_FILTERS) pinned
    // verbatim so the NULL-courier fallback can't silently drift. SKIPPED is
    // not in this list (it was never a filter pill) — it is covered above.
    const legacy: ReadonlyArray<{ value: TaskInternalStatus; label: string; pillClass: string }> = [
      { value: "CREATED", label: "Created", pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-secondary)]" },
      { value: "ASSIGNED", label: "Assigned", pillClass: "bg-amber/15 text-amber" },
      { value: "IN_TRANSIT", label: "In transit", pillClass: "bg-amber/20 text-amber" },
      { value: "DELIVERED", label: "Delivered", pillClass: "bg-green/15 text-green" },
      { value: "FAILED", label: "Failed", pillClass: "bg-red/15 text-red" },
      { value: "CANCELED", label: "Cancelled", pillClass: "bg-[color:var(--color-text-tertiary)]/20 text-[color:var(--color-text-tertiary)]" },
      { value: "ON_HOLD", label: "—", pillClass: "bg-stone-200/60 text-stone-600" },
    ];
    for (const f of legacy) {
      const resolved = resolveCourierDisplay(null, f.value);
      expect(resolved.label).toBe(f.label);
      expect(resolved.pillClass).toBe(f.pillClass);
    }
  });
});
