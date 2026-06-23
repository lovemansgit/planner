import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Field } from "../Field";
import { Select } from "../Select";

// Phase 9 · Step 3.6 — Field + Select render behaviour (Gap G core).

describe("Field", () => {
  it("renders the label, the Optional tag, help text and the control", () => {
    const html = renderToStaticMarkup(
      Field({ label: "Region", htmlFor: "region", optional: true, help: "Pick the delivery region", children: "[CONTROL]" }),
    );
    expect(html).toMatch(/<label[^>]*for="region"[^>]*>Region<\/label>/);
    expect(html).toContain("Optional");
    expect(html).toContain("Pick the delivery region");
    expect(html).toContain("[CONTROL]");
  });

  it("shows the error instead of the help when both are present", () => {
    const html = renderToStaticMarkup(
      Field({ label: "Region", help: "Pick one", error: "Region is required", children: "x" }),
    );
    expect(html).toContain("Region is required");
    expect(html).not.toContain("Pick one");
  });
});

describe("Select", () => {
  it("renders a real native select with options + our chevron", () => {
    const html = renderToStaticMarkup(
      Select({ name: "region", defaultValue: "dxb", children: [
        renderOption("dxb", "Dubai"),
        renderOption("auh", "Abu Dhabi"),
      ] }),
    );
    expect(html).toMatch(/<select[^>]*name="region"/);
    expect(html).toContain("appearance-none");
    expect(html).toContain("Dubai");
    expect(html).toContain("<svg"); // the chevron
  });

  it("invalid state tints red and sets aria-invalid", () => {
    const html = renderToStaticMarkup(Select({ invalid: true, children: renderOption("x", "X") }));
    expect(html).toContain("border-red");
    expect(html).toMatch(/aria-invalid="true"/);
  });
});

function renderOption(value: string, label: string) {
  return <option key={value} value={value}>{label}</option>;
}
