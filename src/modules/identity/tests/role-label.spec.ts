// Phase 9 Step 3.1 (Foundations) — roleLabel tests (Gap J / D4).
// RED-first. roleLabel reuses the ROLES catalogue's `name` field as the
// source of truth (so "CS Agent" / "Transcorp Systems Team" stay correct,
// which a generic humaniser would mangle to "Cs Agent" / "Transcorp Systems").

import { describe, expect, it } from "vitest";

import { roleLabel } from "@/modules/identity/role-label";

describe("roleLabel — role slug → human label", () => {
  it("maps built-in role slugs to their catalogue names", () => {
    expect(roleLabel("tenant-admin")).toBe("Tenant Admin");
    expect(roleLabel("ops-manager")).toBe("Ops Manager");
    expect(roleLabel("cs-agent")).toBe("CS Agent");
    expect(roleLabel("transcorp-systems")).toBe("Transcorp Systems Team");
    expect(roleLabel("transcorp-sysadmin")).toBe("Transcorp Sysadmin");
  });
  it("falls back to a humanised slug for an unknown role", () => {
    expect(roleLabel("regional-lead")).toBe("Regional Lead");
  });
});
