// Item 2 — unit tests for the user-edit pure helpers (role options +
// form parser). No React, no service chain.

import { describe, expect, it } from "vitest";

import {
  parseUserEditForm,
  roleLabel,
  roleOptionsForTenant,
} from "../_helpers";

describe("roleOptionsForTenant", () => {
  it("offers only transcorp-sysadmin for the Transcorp home tenant", () => {
    expect(roleOptionsForTenant("transcorp").map((r) => r.slug)).toEqual([
      "transcorp-sysadmin",
    ]);
  });

  it("offers tenant-admin + ops-manager for a merchant tenant", () => {
    expect(roleOptionsForTenant("demo-bistro").map((r) => r.slug)).toEqual([
      "tenant-admin",
      "ops-manager",
    ]);
  });
});

describe("roleLabel", () => {
  it("maps known slugs to human labels", () => {
    expect(roleLabel("ops-manager")).toBe("Ops Manager");
    expect(roleLabel("transcorp-sysadmin")).toBe("Transcorp Sysadmin");
  });

  it("falls back to the slug for an unknown role", () => {
    expect(roleLabel("wizard")).toBe("wizard");
  });
});

describe("parseUserEditForm", () => {
  const merchantRoles = ["tenant-admin", "ops-manager"];

  function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  }

  it("parses a valid name + role", () => {
    const result = parseUserEditForm(
      fd({ displayName: "  Sarah K  ", roleSlug: "ops-manager" }),
      merchantRoles,
    );
    expect(result).toEqual({
      ok: true,
      value: { displayName: "Sarah K", roleSlug: "ops-manager" },
    });
  });

  it("normalises an all-whitespace name to null", () => {
    const result = parseUserEditForm(fd({ displayName: "   ", roleSlug: "tenant-admin" }), merchantRoles);
    expect(result).toEqual({
      ok: true,
      value: { displayName: null, roleSlug: "tenant-admin" },
    });
  });

  it("rejects a role outside the tenant's allowed set (forged POST)", () => {
    const result = parseUserEditForm(
      fd({ displayName: "X", roleSlug: "transcorp-sysadmin" }),
      merchantRoles,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a name longer than 200 characters", () => {
    const result = parseUserEditForm(
      fd({ displayName: "a".repeat(201), roleSlug: "ops-manager" }),
      merchantRoles,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a missing role", () => {
    const result = parseUserEditForm(fd({ displayName: "X" }), merchantRoles);
    expect(result.ok).toBe(false);
  });
});
