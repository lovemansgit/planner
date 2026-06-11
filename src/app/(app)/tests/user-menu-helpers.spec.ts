// Day 17 / T2 #1 — UserMenu helper unit tests.
//
// Covers the pure resolveDisplayName fallthrough — explicit displayName
// → email local-part → "Account" sentinel. Component-level interaction
// tests (click-outside, escape, aria states, focus management) deferred
// to a future PR that establishes client-component test infrastructure
// per memory/followup_client_component_test_infra.md. This file pins
// the multi-branch fallthrough at unit grade so a future contributor
// can't silently weaken the resolution rules.

import { describe, expect, it } from "vitest";

import type { UserIdentity } from "../layout";
import { resolveDisplayName } from "../user-menu";

function id(overrides: Partial<UserIdentity>): UserIdentity {
  return {
    displayName: null,
    email: "",
    tenantName: "",
    tenantSlug: "",
    ...overrides,
  };
}

describe("resolveDisplayName", () => {
  it("returns identity.displayName when non-empty", () => {
    expect(resolveDisplayName(id({ displayName: "Aria Agent" }))).toBe("Aria Agent");
  });

  it("returns email local-part when displayName is null and email is non-empty", () => {
    expect(resolveDisplayName(id({ displayName: null, email: "agent@planner.test" }))).toBe(
      "agent",
    );
  });

  it("returns email local-part when displayName is empty string and email is non-empty", () => {
    expect(resolveDisplayName(id({ displayName: "", email: "operator@planner.test" }))).toBe(
      "operator",
    );
  });

  it("returns email local-part when displayName is whitespace-only and email is non-empty", () => {
    expect(resolveDisplayName(id({ displayName: "   ", email: "ops@planner.test" }))).toBe("ops");
  });

  it("returns 'Account' when displayName is null AND email is empty", () => {
    expect(resolveDisplayName(id({ displayName: null, email: "" }))).toBe("Account");
  });

  it("returns 'Account' when displayName is null AND email is whitespace-only", () => {
    // The split("@")[0]?.trim() collapses whitespace-only locals to
    // empty; the fallthrough then lands on the sentinel. Pinned so a
    // future contributor swapping trim() for something else can't
    // silently re-introduce a whitespace-leading display name.
    expect(resolveDisplayName(id({ displayName: null, email: "   " }))).toBe("Account");
  });

  it("returns 'Account' when displayName is null AND email is undefined (defensive)", () => {
    // The UserIdentity contract says email is `string`, but the helper
    // pre-empts a future widening of the prop or a programming-error
    // call site that passes through unvalidated input. The optional
    // chain on email?.split also covers this.
    const identity = { displayName: null, tenantName: "", tenantSlug: "" } as unknown as UserIdentity;
    expect(resolveDisplayName(identity)).toBe("Account");
  });

  it("handles emails with multiple @ correctly (splits at first @ only)", () => {
    // Pathological but valid-on-the-wire — the local part is everything
    // before the FIRST @. split("@")[0] does this correctly; pinned so
    // a future refactor swapping to a different splitter can't break the
    // contract on edge inputs.
    expect(
      resolveDisplayName(id({ displayName: null, email: "weird@local@planner.test" })),
    ).toBe("weird");
  });

  it("prefers explicit displayName over email even when both present", () => {
    // The fallthrough order is locked: displayName wins when non-empty,
    // regardless of what email holds. Pinned so a refactor can't
    // accidentally invert the priority.
    expect(
      resolveDisplayName(id({ displayName: "Operator One", email: "op1@planner.test" })),
    ).toBe("Operator One");
  });
});
