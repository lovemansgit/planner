// Day-23 §3.3.2 — Spec for the Toast component's pure URL helper.
// React render assertions deferred per
// memory/followup_client_component_test_infra.md (no jsdom in unit
// project); covers the `stripParamFromSearchParams` extraction.

import { describe, expect, it } from "vitest";

import { stripParamFromSearchParams } from "../Toast";

describe("stripParamFromSearchParams", () => {
  it("removes the named param and returns the residual query string", () => {
    const params = new URLSearchParams("created=1&tab=overview");
    expect(stripParamFromSearchParams(params, "created")).toBe("tab=overview");
  });

  it("returns an empty string when the only param is the one stripped", () => {
    const params = new URLSearchParams("created=1");
    expect(stripParamFromSearchParams(params, "created")).toBe("");
  });

  it("returns an empty string for an already-empty searchParams", () => {
    const params = new URLSearchParams();
    expect(stripParamFromSearchParams(params, "created")).toBe("");
  });

  it("is a no-op when the param is not present (other params preserved)", () => {
    const params = new URLSearchParams("tab=history&view=week");
    const result = stripParamFromSearchParams(params, "created");
    expect(result).toContain("tab=history");
    expect(result).toContain("view=week");
  });

  it("does not mutate the input URLSearchParams", () => {
    const params = new URLSearchParams("created=1&tab=overview");
    stripParamFromSearchParams(params, "created");
    expect(params.toString()).toBe("created=1&tab=overview");
  });

  it("strips all occurrences if the param appears multiple times", () => {
    const params = new URLSearchParams("created=1&created=2&tab=overview");
    expect(stripParamFromSearchParams(params, "created")).toBe("tab=overview");
  });

  it("handles arbitrary param keys (not hard-coded to 'created')", () => {
    const params = new URLSearchParams("success=true&tab=overview");
    expect(stripParamFromSearchParams(params, "success")).toBe("tab=overview");
  });
});
