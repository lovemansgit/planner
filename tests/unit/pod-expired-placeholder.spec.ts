// H3 — POD expired-at-vendor placeholder (Day-53 EVE lane).
// Pins the styled empty state the proxy route serves instead of the
// bare 410: valid standalone SVG, the operator-facing copy, and the
// accessibility label. The route attaches X-Planner-Pod-State:
// expired-at-vendor; machine consumers key on the header, humans on
// this image.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Direct file import — the module index drags the db-backed service
// (env-required at import) into the dependency graph; the placeholder
// itself is pure and dependency-free.
import { podExpiredPlaceholderSvg } from "../../src/modules/pod-capture/expired-placeholder";

describe("podExpiredPlaceholderSvg (H3)", () => {
  it("is a standalone SVG with the expired-at-vendor message", () => {
    const svg = podExpiredPlaceholderSvg();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain("Photo expired at the delivery vendor");
    expect(svg).toContain('aria-label="Photo expired at the delivery vendor"');
    // 7-day TTL is the operator-facing explanation line.
    expect(svg).toContain("7 days");
  });

  it("is stable (pure function — same output every call)", () => {
    expect(podExpiredPlaceholderSvg()).toBe(podExpiredPlaceholderSvg());
  });
});
