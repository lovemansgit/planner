import { describe, expect, it } from "vitest";

import {
  statusBadgeClass,
  statusMeta,
  statusToneClass,
  type StatusDomain,
  type StatusTone,
} from "../status-badge-recipe";

// Phase 9 · Step 3.3 — the shared <StatusBadge> recipe (Gap B).
//
// One soft-filled, dot-less, sentence-case, rounded-full pill family for the
// CRM / subscription / push domains, skinned to Direction B+. These tests LOCK
// (a) the pill geometry per tone + size and (b) EVERY domain→{label,tone}
// mapping, so a future edit cannot silently re-drift the status render or
// relabel a state. Task surfaces are deliberately absent (status-filter lane).

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

const BASE = ["inline-flex", "items-center", "justify-center", "rounded-full", "font-semibold"];

const TONE_CLASS: Record<StatusTone, string[]> = {
  active: [
    "bg-[color:var(--color-status-active-bg)]",
    "text-[color:var(--color-status-active-ink)]",
  ],
  paused: [
    "bg-[color:var(--color-status-paused-bg)]",
    "text-[color:var(--color-status-paused-ink)]",
  ],
  risk: ["bg-[color:var(--color-status-risk-bg)]", "text-[color:var(--color-status-risk-ink)]"],
  ended: ["bg-[color:var(--color-status-ended-bg)]", "text-[color:var(--color-status-ended-ink)]"],
  new: ["bg-[color:var(--color-status-new-bg)]", "text-[color:var(--color-status-new-ink)]"],
};

describe("statusBadgeClass", () => {
  it("md (default) reproduces the B+ soft-fill pill per tone exactly", () => {
    for (const tone of Object.keys(TONE_CLASS) as StatusTone[]) {
      const got = classSet(statusBadgeClass(tone));
      const expected = new Set([...BASE, "px-2.5", "py-0.5", "text-xs", ...TONE_CLASS[tone]]);
      expect(got).toEqual(expected);
    }
  });

  it("lg widens padding only (header pill)", () => {
    const got = classSet(statusBadgeClass("active", "lg"));
    const expected = new Set([...BASE, "px-3", "py-1", "text-xs", ...TONE_CLASS.active]);
    expect(got).toEqual(expected);
  });

  it("defaults to md when size is omitted", () => {
    expect(classSet(statusBadgeClass("paused"))).toEqual(classSet(statusBadgeClass("paused", "md")));
  });

  it("appends caller treatment classes", () => {
    const got = classSet(statusBadgeClass("active", "md", "w-[140px]"));
    expect(got.has("w-[140px]")).toBe(true);
  });

  it("never carries uppercase or letter-spacing (D2 sentence-case)", () => {
    const out = statusBadgeClass("active");
    expect(out).not.toContain("uppercase");
    expect(out).not.toMatch(/tracking-/);
  });

  it("emits no leading/trailing/double whitespace when className is empty", () => {
    const out = statusBadgeClass("ended", "md", "");
    expect(out).toBe(out.trim());
    expect(out).not.toMatch(/\s{2,}/);
  });
});

describe("statusToneClass", () => {
  it("returns fill + ink only, no geometry", () => {
    for (const tone of Object.keys(TONE_CLASS) as StatusTone[]) {
      expect(classSet(statusToneClass(tone))).toEqual(new Set(TONE_CLASS[tone]));
    }
  });
});

describe("statusMeta — domain→{label,tone} contract", () => {
  it("maps subscription statuses (active/paused/ended)", () => {
    expect(statusMeta("subscription", "active")).toEqual({ label: "Active", tone: "active" });
    expect(statusMeta("subscription", "paused")).toEqual({ label: "Paused", tone: "paused" });
    expect(statusMeta("subscription", "ended")).toEqual({ label: "Ended", tone: "ended" });
  });

  it("maps the six CRM states with sentence-case labels (no CHURNED strikethrough)", () => {
    expect(statusMeta("crm", "ACTIVE")).toEqual({ label: "Active", tone: "active" });
    expect(statusMeta("crm", "ON_HOLD")).toEqual({ label: "On hold", tone: "paused" });
    expect(statusMeta("crm", "HIGH_RISK")).toEqual({ label: "High risk", tone: "risk" });
    expect(statusMeta("crm", "INACTIVE")).toEqual({ label: "Inactive", tone: "ended" });
    expect(statusMeta("crm", "CHURNED")).toEqual({ label: "Churned", tone: "ended" });
    expect(statusMeta("crm", "SUBSCRIPTION_ENDED")).toEqual({ label: "Ended", tone: "ended" });
  });

  it("maps push as a binary lifecycle (failure reason is a separate field)", () => {
    expect(statusMeta("push", "unresolved")).toEqual({ label: "Unresolved", tone: "risk" });
    expect(statusMeta("push", "resolved")).toEqual({ label: "Resolved", tone: "ended" });
  });

  it("returns null for an unknown status (component humanises instead of crashing)", () => {
    const domains: StatusDomain[] = ["subscription", "crm", "push"];
    for (const d of domains) expect(statusMeta(d, "definitely_not_a_state")).toBeNull();
  });
});
