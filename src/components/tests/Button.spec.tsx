import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button, resolveLinkClickHandler } from "../Button";

// Phase 12 · Batch BTN — <Button href> server-safety.
//
// The recipe spec (button-recipe.spec) locks the class geometry; this locks the
// behaviour that keeps the shared <Button> renderable from a SERVER component.
// The trap (caused the prod /subscriptions 500): the link branch used to
// FABRICATE a handler and hand it to the client <Link> on every render. A
// function crossing the RSC boundary throws "Event handlers cannot be passed to
// Client Component props". The fix forwards a handler ONLY when the caller
// passed one — resolveLinkClickHandler is that decision, unit-locked here so a
// future edit can't silently re-introduce an always-fabricated handler.

function fakeAnchorEvent() {
  const preventDefault = vi.fn();
  return { event: { preventDefault } as unknown as MouseEvent<HTMLAnchorElement>, preventDefault };
}

describe("resolveLinkClickHandler — the server-safety contract", () => {
  it("returns undefined when no onClick is given (nothing crosses the RSC boundary)", () => {
    expect(resolveLinkClickHandler(undefined, false)).toBeUndefined();
  });

  it("returns undefined for a disabled link with no onClick too (still server-safe)", () => {
    // Inertness comes from aria-disabled + tabIndex, NOT a fabricated handler.
    expect(resolveLinkClickHandler(undefined, true)).toBeUndefined();
  });

  it("forwards the caller's onClick when enabled", () => {
    const onClick = vi.fn();
    const handler = resolveLinkClickHandler(onClick, false);
    expect(handler).toBeTypeOf("function");
    const { event, preventDefault } = fakeAnchorEvent();
    handler!(event);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("blocks the onClick (and the navigation) when disabled, for every variant", () => {
    const onClick = vi.fn();
    const handler = resolveLinkClickHandler(onClick, true);
    const { event, preventDefault } = fakeAnchorEvent();
    handler!(event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Button link mode — markup", () => {
  it("a plain <Button href> renders an anchor with the primary recipe (server-safe)", () => {
    const html = renderToStaticMarkup(Button({ href: "/welcome", variant: "primary", children: "New subscription" }));
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="/welcome"');
    expect(html).toContain("New subscription");
    expect(html).toContain("bg-green"); // primary treatment preserved
    // No aria-disabled ATTRIBUTE on an enabled link (the recipe class string
    // carries `aria-disabled:*` Tailwind variants, so match the attribute).
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).not.toContain('tabindex="-1"');
  });

  it("a disabled <Button href> stays an inert anchor (aria-disabled + tabindex=-1, no navigation handler)", () => {
    const html = renderToStaticMarkup(
      Button({ href: "/welcome", variant: "primary", disabled: true, children: "Disabled" }),
    );
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('tabindex="-1"');
    // The B recipe maps aria-disabled to pointer-events-none → inert without JS.
    expect(html).toContain("aria-disabled:pointer-events-none");
  });

  it("ghost link (the CredentialsForm shape) renders the ghost treatment", () => {
    const html = renderToStaticMarkup(Button({ href: "/admin/merchants/abc", variant: "ghost", children: "Back" }));
    expect(html).toMatch(/^<a /);
    expect(html).toContain("bg-transparent");
    expect(html).toContain("Back");
  });
});
