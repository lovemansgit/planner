import { describe, expect, it } from "vitest";

import { EMPTY_BODY, EMPTY_INLINE, EMPTY_TITLE, emptyBlockClass } from "../empty-state-recipe";

// Phase 9 · Step 3.6 — the shared EmptyState recipe (Gap H).
//
// One empty treatment for empty lists (block) and empty values (inline),
// replacing the four divergent treatments the audit found. These tests lock the
// block geometry, the B+ display title, and the muted inline value, and assert
// the title is sentence-case (D2).

function classSet(s: string): Set<string> {
  return new Set(s.split(/\s+/).filter(Boolean));
}

describe("emptyBlockClass", () => {
  it("is a centred, vertically-generous panel with hairline rules", () => {
    const c = classSet(emptyBlockClass());
    expect(c.has("text-center")).toBe(true);
    expect(c.has("border-y")).toBe(true);
    expect(c.has("py-16")).toBe(true);
  });

  it("appends caller treatment", () => {
    expect(classSet(emptyBlockClass("mt-8")).has("mt-8")).toBe(true);
  });
});

describe("title / body / inline constants", () => {
  it("the title is the B+ display face, sentence-case (D2 — never uppercase)", () => {
    expect(EMPTY_TITLE).toContain("font-b-display");
    expect(EMPTY_TITLE).not.toContain("uppercase");
  });

  it("the body is muted secondary text", () => {
    expect(EMPTY_BODY).toContain("--color-text-secondary");
  });

  it("the inline variant is a muted value (replaces a bare —)", () => {
    expect(EMPTY_INLINE).toContain("--color-text-tertiary");
    expect(EMPTY_INLINE).not.toContain("uppercase");
  });
});
