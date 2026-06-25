// Shared <DataTable> (Phase 9 · Step 3.4 — Gap C).
//
// One dense, floating-card table for the platform's list surfaces, skinned to
// Direction B+. Columns are declared once (header, alignment, mono, custom
// cell); the component owns the never-wrap headers, truncation, mono-figure
// rule, optional status-LED gutter, optional clickable rows, and mobile
// overflow containment.
//
// Not for task surfaces — the status-filter lane owns /tasks + /admin/tasks.

import Link from "next/link";
import type { ReactNode } from "react";

import { CopyableCell } from "./CopyableCell";
import {
  STICKY_RIGHT_TD,
  STICKY_RIGHT_TH,
  STICKY_SHADOW,
  TABLE,
  TABLE_CARD,
  TABLE_SCROLL,
  gutterTdClass,
  gutterThClass,
  tdClass,
  thClass,
  type DataTableAlign,
  type DataTableDensity,
} from "./data-table-recipe";
import type { StatusTone } from "./status-badge-recipe";

export interface DataTableColumn<Row> {
  /** Stable key for React + the mobile label. */
  readonly key: string;
  /** Header label; rendered as a never-wrap eyebrow (or visually hidden). */
  readonly header: ReactNode;
  /** Visually hide the header (e.g. an actions column). */
  readonly srHeader?: boolean;
  readonly align?: DataTableAlign;
  /** Render figures in the B+ mono tabular face. */
  readonly mono?: boolean;
  /** Extra cell classes (e.g. a name cell's display face, a wider max-width). */
  readonly cellClassName?: string;
  readonly headerClassName?: string;
  /** Cell content for a row. */
  readonly cell: (row: Row) => ReactNode;
  /** Opt this column out of the row-link wrap (e.g. an actions cell). */
  readonly noRowLink?: boolean;
  /**
   * Pin this column to the right edge of the horizontal-scroll viewport so it
   * stays fully visible + clickable when a wide table scrolls within the card.
   * Used for the admin actions column, which would otherwise overflow the
   * shared content width on desktop. Opt-in — every existing column renders
   * byte-identically without it.
   */
  readonly stickyRight?: boolean;
  /** Plain-text value used as the truncation tooltip + mobile fallback. */
  readonly title?: (row: Row) => string | undefined;
  /**
   * Phase 12.2 Batch B / Item 6 — render this (truncating) cell with a
   * hover copy affordance (CopyableCell). Used for the identity columns
   * (Merchant / Consignee / Email / Tenant) so a long value can be copied
   * without widening the column. Requires `title(row)` — the full value to
   * copy. Composes with the row-link: the text still navigates, the copy
   * button does not.
   */
  readonly copyable?: boolean;
}

interface DataTableProps<Row> {
  readonly columns: ReadonlyArray<DataTableColumn<Row>>;
  readonly rows: readonly Row[];
  readonly getRowKey: (row: Row) => string;
  /** Make rows clickable; non-action cells wrap in this href. */
  readonly rowHref?: (row: Row) => string;
  /** Light a status-LED at the row edge from the row's tone. */
  readonly led?: (row: Row) => StatusTone | undefined;
  readonly density?: DataTableDensity;
  /** Optional slot above the table inside the card (e.g. a metric ribbon). */
  readonly header?: ReactNode;
  /** Accessible caption for the table. */
  readonly caption?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  getRowKey,
  rowHref,
  led,
  density = "comfortable",
  header,
  caption,
}: DataTableProps<Row>) {
  const hasGutter = led !== undefined;
  return (
    <div className={TABLE_CARD}>
      {header}
      <div className={TABLE_SCROLL}>
        <table className={TABLE}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {hasGutter ? <th className={gutterThClass()} aria-hidden /> : null}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={thClass(
                    density,
                    col.align,
                    [col.headerClassName, col.stickyRight ? STICKY_RIGHT_TH : ""]
                      .filter(Boolean)
                      .join(" "),
                  )}
                  style={col.stickyRight ? { boxShadow: STICKY_SHADOW } : undefined}
                >
                  {col.srHeader ? <span className="sr-only">{col.header}</span> : col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              const tone = led?.(row);
              return (
                <tr
                  key={getRowKey(row)}
                  className="border-b border-[color:var(--color-border-default)] transition-colors duration-[120ms] ease-out last:border-b-0 hover:bg-[rgba(37,45,96,0.025)]"
                >
                  {hasGutter ? (
                    <td className={tone ? gutterTdClass(tone) : "w-1 p-0"} aria-hidden />
                  ) : null}
                  {columns.map((col) => {
                    const content = col.cell(row);
                    const title = col.title?.(row);
                    const linkHref = href && !col.noRowLink ? href : undefined;
                    const wrapped = col.copyable ? (
                      // Item 6 — keep the "…" + native-title reveal, add a hover
                      // copy button. CopyableCell owns the row-link internally so
                      // the text still navigates while the copy button does not.
                      <CopyableCell value={title ?? ""} href={linkHref}>
                        {content}
                      </CopyableCell>
                    ) : linkHref ? (
                      // `truncate` lives on the link, not just the <td>: a block
                      // child suppresses the cell's text-overflow:ellipsis, so a
                      // row-linked cell would hard-clip mid-character with no
                      // ellipsis. Truncating the link restores the … (admin slug
                      // truncation fix).
                      <Link href={linkHref} className="block truncate">
                        {content}
                      </Link>
                    ) : (
                      content
                    );
                    return (
                      <td
                        key={col.key}
                        className={tdClass(
                          density,
                          col.align,
                          col.mono,
                          [col.cellClassName, col.stickyRight ? STICKY_RIGHT_TD : ""]
                            .filter(Boolean)
                            .join(" "),
                        )}
                        style={col.stickyRight ? { boxShadow: STICKY_SHADOW } : undefined}
                        title={title}
                      >
                        {wrapped}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
