// Phase 9 Step 3.1 — text-recipe locks D2 (casing rule).

import { describe, expect, it } from "vitest";

import { textClass } from "@/components/text-recipe";

describe("text-recipe — encodes D2 (sentence-case default; uppercase eyebrows only)", () => {
  it("eyebrow is the only uppercase role", () => {
    expect(textClass("eyebrow")).toContain("uppercase");
  });
  it("every human-facing role is NOT uppercase (sentence-case default)", () => {
    for (const role of ["display", "heading", "body", "caption"] as const) {
      expect(textClass(role)).not.toContain("uppercase");
    }
  });
  it("appends caller className", () => {
    expect(textClass("body", "mt-2")).toContain("mt-2");
  });
});
