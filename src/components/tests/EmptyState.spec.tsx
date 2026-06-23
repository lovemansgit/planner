import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EmptyState } from "../EmptyState";

// Phase 9 · Step 3.6 — EmptyState render behaviour (Gap H).

describe("EmptyState", () => {
  it("block: renders title, body and an action", () => {
    const html = renderToStaticMarkup(
      EmptyState({ title: "No subscriptions yet", body: "Onboard a consignee to begin.", action: "[ACTION]" }),
    );
    expect(html).toContain("No subscriptions yet");
    expect(html).toContain("Onboard a consignee to begin.");
    expect(html).toContain("[ACTION]");
    expect(html).toContain("py-16");
  });

  it("block: omits body and action when not given", () => {
    const html = renderToStaticMarkup(EmptyState({ title: "Nothing here" }));
    expect(html).toContain("Nothing here");
    expect(html).not.toContain("[ACTION]");
  });

  it("inline: renders a single muted value (replaces a bare —)", () => {
    const html = renderToStaticMarkup(EmptyState({ title: "Not set", variant: "inline" }));
    expect(html).toMatch(/<span[^>]*>Not set<\/span>/);
    expect(html).toContain("--color-text-tertiary");
    expect(html).not.toContain("py-16");
  });
});
