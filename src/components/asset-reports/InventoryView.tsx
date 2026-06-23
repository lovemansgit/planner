// Inventory report view — Day-54 P2 (plan PR #502 §6.B).
//
// Shared by the merchant /reports/inventory page and the Transcorp
// /admin/inventory page (same information design, different drill-down
// base path + scope). Server component; the by-consignee expand state
// lives in the ConsigneeRows client child.
//
// Information design mirrors SF's own report screens (Love's
// screenshots): a by-date section and a by-consignee section, both
// with Delivery Date / Assets Allocated / Supp. Qty / Collected /
// Received / Sorted / En Route / Returned; every value links to its
// AWB set on the tasks list.

import type {
  InventoryByConsigneeRow,
  InventoryByDateRow,
} from "@/modules/asset-tracking/report-repository";

import { ConsigneeRows } from "./ConsigneeRows";
import { CountCell, ReportHeaderCells } from "./ReportCells";
import { awbsHref } from "./report-helpers";
import {
  REPORT_EMPTY,
  REPORT_ROW,
  REPORT_TD,
  REPORT_TH,
  TABLE,
  TABLE_CARD,
  TABLE_SCROLL,
} from "./report-table";

export interface InventoryViewProps {
  readonly byDate: readonly InventoryByDateRow[];
  readonly byConsignee: readonly InventoryByConsigneeRow[];
  /** Tasks-list path drill-downs land on (`/tasks` or `/admin/tasks`). */
  readonly tasksBasePath: string;
  /** Extra query params carried on every drill-down (e.g. admin merchant). */
  readonly extraTaskParams?: Readonly<Record<string, string>>;
}

export function InventoryView({
  byDate,
  byConsignee,
  tasksBasePath,
  extraTaskParams = {},
}: InventoryViewProps) {
  return (
    <>
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight">By delivery date</h2>
        {byDate.length === 0 ? (
          <p className={REPORT_EMPTY}>No asset data in this date range.</p>
        ) : (
          <div className={TABLE_CARD}>
            <div className={TABLE_SCROLL}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={REPORT_TH}>Delivery date</th>
                    <ReportHeaderCells />
                  </tr>
                </thead>
                <tbody>
                  {byDate.map((row) => (
                    <tr key={row.deliveryDate} className={REPORT_ROW}>
                      <td className={`${REPORT_TD} font-medium`}>{row.deliveryDate}</td>
                      <CountCell
                        value={row.allocatedAssets}
                        href={awbsHref(tasksBasePath, row.awbs, extraTaskParams)}
                      />
                      <CountCell
                        value={row.suppQuantity}
                        href={awbsHref(tasksBasePath, row.awbs, extraTaskParams)}
                      />
                      <CountCell
                        value={row.collected}
                        href={awbsHref(tasksBasePath, row.awbsByState.collected, extraTaskParams)}
                      />
                      <CountCell
                        value={row.received}
                        href={awbsHref(tasksBasePath, row.awbsByState.received, extraTaskParams)}
                      />
                      <CountCell
                        value={row.sorted}
                        href={awbsHref(tasksBasePath, row.awbsByState.sorted, extraTaskParams)}
                      />
                      <CountCell
                        value={row.enRoute}
                        href={awbsHref(tasksBasePath, row.awbsByState.enRoute, extraTaskParams)}
                      />
                      <CountCell
                        value={row.returned}
                        href={awbsHref(tasksBasePath, row.awbsByState.returned, extraTaskParams)}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold tracking-tight">By consignee</h2>
        {byConsignee.length === 0 ? (
          <p className={REPORT_EMPTY}>No asset data in this date range.</p>
        ) : (
          <ConsigneeRows
            rows={byConsignee}
            tasksBasePath={tasksBasePath}
            extraTaskParams={extraTaskParams}
          />
        )}
      </section>
    </>
  );
}
