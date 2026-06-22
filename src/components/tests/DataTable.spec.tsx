import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable, type DataTableColumn } from "../DataTable";

// Phase 9 · Step 3.4 — <DataTable> render behaviour (Gap C).
//
// The recipe spec locks the class geometry; this locks the component's wiring:
// the status-LED gutter, the row-link wrap (with the actions column opting out),
// mono cells, the never-wrap header, and the accessible caption.

interface Row {
  readonly id: string;
  readonly name: string;
  readonly date: string;
}

const ROWS: readonly Row[] = [{ id: "r1", name: "Fatima Al Mansouri", date: "2026-06-11" }];

const COLUMNS: ReadonlyArray<DataTableColumn<Row>> = [
  { key: "name", header: "Name", cell: (r) => r.name, title: (r) => r.name },
  { key: "date", header: "Date", mono: true, align: "right", cell: (r) => r.date },
  {
    key: "actions",
    header: "Actions",
    srHeader: true,
    align: "right",
    noRowLink: true,
    cell: () => "Materialize",
  },
];

function render(extra?: Partial<Parameters<typeof DataTable<Row>>[0]>) {
  return renderToStaticMarkup(
    DataTable<Row>({
      columns: COLUMNS,
      rows: ROWS,
      getRowKey: (r) => r.id,
      rowHref: (r) => `/admin/subscriptions/${r.id}`,
      led: () => "active",
      caption: "All subscriptions",
      ...extra,
    }),
  );
}

describe("DataTable", () => {
  it("lights the status-LED gutter from the row tone", () => {
    expect(render()).toContain("bg-[color:var(--color-led-active)]");
  });

  it("omits the gutter entirely when no led is provided", () => {
    expect(render({ led: undefined })).not.toContain("color-led-");
  });

  it("wraps non-action cells in the row link", () => {
    const html = render();
    expect(html).toContain('href="/admin/subscriptions/r1"');
    expect(html).toMatch(/<a[^>]*>Fatima Al Mansouri/);
  });

  it("does NOT wrap the actions cell in the row link", () => {
    expect(render()).not.toMatch(/<a[^>]*>Materialize/);
  });

  it("renders mono figure cells in the B+ mono face", () => {
    expect(render()).toContain("font-b-mono");
  });

  it("never wraps header text and hides the actions header", () => {
    const html = render();
    expect(html).toContain("whitespace-nowrap");
    expect(html).toMatch(/sr-only[^>]*>Actions/);
  });

  it("renders an accessible caption", () => {
    expect(render()).toMatch(/<caption[^>]*sr-only[^>]*>All subscriptions/);
  });
});
