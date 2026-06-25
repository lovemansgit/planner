// Day 26 / T3 Sub-PR 3 — unit tests for the regions admin helpers.
//
// Covers:
//   - parseCreateRegionForm: happy path + each fieldError branch
//   - authMethodBadge / regionStatusBadge: stable label + className mapping
//
// Pure-function tests; no DB, no module mocks beyond the trivial type imports.

import { describe, expect, it } from "vitest";

import {
  authMethodBadge,
  CANONICAL_REGION_CLIENT_IDS,
  isCanonicalRegion,
  parseCreateRegionForm,
  regionStatusBadge,
} from "../_helpers";

describe("parseCreateRegionForm", () => {
  function fd(values: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(values)) f.set(k, v);
    return f;
  }

  function fullForm(overrides: Record<string, string> = {}): FormData {
    return fd({
      client_id: "transcorpuae",
      display_name: "Transcorp UAE",
      auth_method: "api_key",
      ...overrides,
    });
  }

  it("happy path — all fields supplied", () => {
    const result = parseCreateRegionForm(fullForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        clientId: "transcorpuae",
        displayName: "Transcorp UAE",
        authMethod: "api_key",
      });
    }
  });

  it("trims surrounding whitespace on display_name and client_id", () => {
    const result = parseCreateRegionForm(
      fullForm({ client_id: "  transcorpuae  ", display_name: "  Transcorp UAE  " }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clientId).toBe("transcorpuae");
      expect(result.value.displayName).toBe("Transcorp UAE");
    }
  });

  it("lowercases client_id (case-insensitive operator input)", () => {
    const result = parseCreateRegionForm(fullForm({ client_id: "TRANScorpUAE" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.clientId).toBe("transcorpuae");
    }
  });

  it("empty client_id returns field error", () => {
    const result = parseCreateRegionForm(fullForm({ client_id: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.client_id).toBeTruthy();
  });

  it("client_id with hyphen rejected (mirrors ^[a-z][a-z0-9]*$)", () => {
    const result = parseCreateRegionForm(fullForm({ client_id: "transcorp-uae" }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.client_id).toMatch(/lowercase letters or digits/);
  });

  it("client_id starting with digit rejected", () => {
    const result = parseCreateRegionForm(fullForm({ client_id: "1transcorp" }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.client_id).toMatch(/lowercase letter/);
  });

  it("client_id with underscore rejected (matches migration 0024 CHECK)", () => {
    const result = parseCreateRegionForm(fullForm({ client_id: "transcorp_uae" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.client_id).toBeTruthy();
  });

  it("empty display_name returns field error", () => {
    const result = parseCreateRegionForm(fullForm({ display_name: "  " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.display_name).toBeTruthy();
  });

  it("empty auth_method returns field error (no default — operator must pick)", () => {
    const result = parseCreateRegionForm(fullForm({ auth_method: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.fieldErrors.auth_method).toMatch(/permanent/);
  });

  it("unknown auth_method rejected (defense against manual POST)", () => {
    const result = parseCreateRegionForm(fullForm({ auth_method: "jwt" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.auth_method).toBeTruthy();
  });

  it("oauth auth_method accepted", () => {
    const result = parseCreateRegionForm(fullForm({ auth_method: "oauth" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.authMethod).toBe("oauth");
  });
});

describe("authMethodBadge", () => {
  it("oauth label is OAuth", () => {
    expect(authMethodBadge("oauth").label).toBe("OAuth");
  });
  it("api_key label is API Key", () => {
    expect(authMethodBadge("api_key").label).toBe("API Key");
  });
  it("both flavors render with stone-neutral className (no semantic color)", () => {
    // Brand discipline pin: neither auth method is "preferred"; both
    // render in the same muted treatment to avoid implying a default.
    expect(authMethodBadge("oauth").className).toEqual(
      authMethodBadge("api_key").className,
    );
  });
});

describe("isCanonicalRegion (Phase 12.2 Item 5 — display-only list filter)", () => {
  it("the allowlist is exactly the four seeded SuiteFleet client_ids (migration 0024)", () => {
    expect([...CANONICAL_REGION_CLIENT_IDS].sort()).toEqual(
      ["transcorp", "transcorpqatar", "transcorpsb", "transcorpuae"].sort(),
    );
    expect(CANONICAL_REGION_CLIENT_IDS.size).toBe(4);
  });

  it("returns true for each of the four canonical regions", () => {
    for (const clientId of [
      "transcorpsb",
      "transcorp",
      "transcorpuae",
      "transcorpqatar",
    ]) {
      expect(isCanonicalRegion({ clientId })).toBe(true);
    }
  });

  it("returns false for seed/test junk regions", () => {
    expect(isCanonicalRegion({ clientId: "acdoauthregion" })).toBe(false);
    expect(isCanonicalRegion({ clientId: "abc123" })).toBe(false);
    expect(isCanonicalRegion({ clientId: "" })).toBe(false);
  });

  it("is EXACT membership, not a prefix match (the 'transcorp' prefix trap)", () => {
    // "transcorp" (KSA) is a prefix of the other three canonical ids and of any
    // junk id that happens to start with it — a startsWith filter would wrongly
    // keep junk like "transcorpfoo". Set membership keeps each literal distinct.
    expect(isCanonicalRegion({ clientId: "transcorpfoo" })).toBe(false);
    expect(isCanonicalRegion({ clientId: "transcorpsbx" })).toBe(false);
    expect(isCanonicalRegion({ clientId: "transcorp2" })).toBe(false);
  });
});

describe("regionStatusBadge", () => {
  it("active label is Active and uses green semantic", () => {
    const badge = regionStatusBadge("active");
    expect(badge.label).toBe("Active");
    expect(badge.className).toContain("green");
  });

  it("inactive label is Inactive and uses muted stone semantic", () => {
    const badge = regionStatusBadge("inactive");
    expect(badge.label).toBe("Inactive");
    expect(badge.className).toContain("tertiary");
  });
});
