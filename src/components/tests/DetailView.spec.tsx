import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DetailHeader, DetailSection, DetailView } from "../DetailView";
import { FieldRow } from "../FieldRow";

// Phase 9 · Step 3.5 — detail-view render behaviour (Gap D).
//
// The recipe spec locks the class geometry; this locks the composition: the
// navy spine, the real <h1>, the inline status + actions, the section <dl>, and
// FieldRow's sentence-case label + inline empty state + mono values.

describe("DetailHeader", () => {
  const html = renderToStaticMarkup(
    DetailHeader({
      eyebrow: "Transcorp · Consignee",
      title: "Fatima Al Mansouri",
      status: "[STATUS]",
      actions: "[ACTIONS]",
    }),
  );

  it("renders the title as a real <h1>", () => {
    expect(html).toMatch(/<h1[^>]*>Fatima Al Mansouri<\/h1>/);
  });

  it("shows the eyebrow, status and actions slots", () => {
    expect(html).toContain("Transcorp · Consignee");
    expect(html).toContain("[STATUS]");
    expect(html).toContain("[ACTIONS]");
  });
});

describe("DetailView", () => {
  const html = renderToStaticMarkup(
    DetailView({ header: "[HEADER]", children: "[SECTIONS]" }),
  );

  it("renders the navy structural spine (never a band)", () => {
    expect(html).toContain("bg-navy");
    expect(html).toContain("w-[3px]");
  });

  it("lays the body out two-column (D3 DetailGrid)", () => {
    expect(html).toContain("md:grid-cols-2");
  });

  it("places the header above the body", () => {
    expect(html.indexOf("[HEADER]")).toBeLessThan(html.indexOf("[SECTIONS]"));
  });
});

describe("DetailSection", () => {
  it("renders a labelled <dl> of rows", () => {
    const html = renderToStaticMarkup(DetailSection({ label: "Contact", children: "[ROWS]" }));
    expect(html).toContain("Contact");
    expect(html).toMatch(/<dl[^>]*>\[ROWS\]<\/dl>/);
  });
});

describe("FieldRow", () => {
  it("renders label + value", () => {
    const html = renderToStaticMarkup(FieldRow({ label: "Phone", value: "+971 50 333 3333", mono: true }));
    expect(html).toMatch(/<dt[^>]*>Phone<\/dt>/);
    expect(html).toContain("+971 50 333 3333");
    expect(html).toContain("font-b-mono");
  });

  it("renders an inline 'Not set' for an empty value (never a bare —)", () => {
    const html = renderToStaticMarkup(FieldRow({ label: "Secondary address", value: "" }));
    expect(html).toContain("Not set");
    expect(html).not.toContain("—");
  });

  it("never uppercases the label (D2)", () => {
    const html = renderToStaticMarkup(FieldRow({ label: "Email", value: "a@b.com" }));
    expect(html).not.toContain("uppercase");
  });
});
