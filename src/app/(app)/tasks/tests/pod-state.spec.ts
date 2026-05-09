// Day 19 / A2 plan §6.1 — POD column tone helper smoke test.
//
// Per reviewer ruling: one helper test on the muted-vs-active state
// surfacing logic. Lightbox interaction tests deferred (see PR
// description for rationale: demo-readiness > test surface for UI demo
// work).

import { describe, expect, it } from "vitest";

import { podCellState } from "../_components/pod-state";

describe("podCellState", () => {
  it("returns 'muted' when podPhotos is null (no POD received)", () => {
    expect(podCellState(null)).toBe("muted");
  });

  it("returns 'muted' when podPhotos is an empty array (treated as no POD)", () => {
    expect(podCellState([])).toBe("muted");
  });

  it("returns 'active' when podPhotos has one photo URL", () => {
    expect(podCellState(["https://sf.example.com/pod/abc.jpg"])).toBe("active");
  });

  it("returns 'active' when podPhotos has multiple photo URLs", () => {
    expect(
      podCellState([
        "https://sf.example.com/pod/abc.jpg",
        "https://sf.example.com/pod/def.jpg",
        "https://sf.example.com/pod/ghi.jpg",
      ]),
    ).toBe("active");
  });
});
