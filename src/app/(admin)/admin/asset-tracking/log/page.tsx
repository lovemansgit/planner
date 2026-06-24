// Day-54 P3 — the Asset Log (bag-tracking plan PR #502 §6.A: the
// admin report's Allocated Asset count lands here).
//
// Renders append-only asset_scan_log lines for an AWB set, newest
// first: scan date+time per status, never overwriting prior statuses
// (the 0032 trigger enforces never-overwritten structurally; this
// page just renders the lines verbatim).
//
// Timestamp display (Love's ruling verbatim: "if no timestamp then
// put actual timestamp of receiving the data"): vendor_scanned_at
// when present; else received_at labeled "recorded in Planner" —
// SF does not ship scan times on the wire yet (vendor roadmap,
// memory/followup_vendor_scanned_at_activation.md).

import { randomUUID } from "node:crypto";

import Link from "next/link";
import { redirect } from "next/navigation";

import { parseAwbsParam } from "@/components/asset-reports/report-helpers";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { getAssetScanLog } from "@/modules/asset-tracking/report-service";
import type { AssetLogLine } from "@/modules/asset-tracking/report-service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import { shellClass } from "@/components/page-shell-recipe";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatScanTime(line: AssetLogLine): { time: string; recorded: boolean } {
  const iso = line.vendorScannedAt ?? line.receivedAt;
  const time = new Date(iso).toUTCString().replace("GMT", "UTC");
  return { time, recorded: line.vendorScannedAt === null };
}

// Phase 10 · Batch B1 — the Asset Log adopts the shared <DataTable> (Gap C, B+
// skin): floating card, never-wrap eyebrow headers, mono figures, truncation,
// hover, mobile-overflow containment. Pure presentation — the six columns +
// order (Scan time · Status · Package · AWB · Scanned by · Merchant), the
// newest-first order, the "recorded in Planner" timestamp annotation (with its
// tooltip), and the raw scan-state text are all preserved. The asset scan-state
// is rendered verbatim (no StatusBadge — task/asset domains are out of the
// StatusBadge contract and untouched by this batch).
const ASSET_LOG_COLUMNS: ReadonlyArray<DataTableColumn<AssetLogLine>> = [
  {
    key: "scanTime",
    header: "Scan time",
    title: (line) => formatScanTime(line).time,
    cell: (line) => {
      const { time, recorded } = formatScanTime(line);
      return (
        <>
          <span className="font-b-mono tabular-nums">{time}</span>
          {recorded ? (
            <span
              className="ml-2 text-xs text-[color:var(--color-text-secondary)]"
              title="SuiteFleet does not provide scanner timestamps yet; this is when Planner recorded the scan."
            >
              recorded in Planner
            </span>
          ) : null}
        </>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    cellClassName: "font-medium",
    cell: (line) => line.state.replace("_", " "),
  },
  {
    key: "package",
    header: "Package",
    mono: true,
    cell: (line) => line.trackingId,
    title: (line) => line.trackingId,
  },
  {
    key: "awb",
    header: "AWB",
    mono: true,
    cell: (line) => line.awb,
    title: (line) => line.awb,
  },
  {
    key: "scannedBy",
    header: "Scanned by",
    cell: (line) => line.scannedByName ?? "—",
    title: (line) => line.scannedByName ?? undefined,
  },
  {
    key: "merchant",
    header: "Merchant",
    cell: (line) => line.merchantName,
    title: (line) => line.merchantName,
  },
];

interface AssetLogPageProps {
  readonly searchParams: Promise<{ readonly awbs?: string }>;
}

export default async function AssetLogPage({ searchParams }: AssetLogPageProps) {
  const requestId = randomUUID();
  const params = await searchParams;
  const awbs = parseAwbsParam(params.awbs);

  let lines: readonly AssetLogLine[] = [];
  try {
    const ctx = await buildRequestContext("/admin/asset-tracking/log", requestId);
    if (awbs.length > 0) {
      lines = await getAssetScanLog(ctx, { awbs });
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/asset-tracking/log"));
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NoTenantConfiguredError) {
      redirect("/");
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className={shellClass("py-16")}>
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Reports
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Asset Log</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Every recorded scan, newest first. Lines are append-only — prior
            statuses are never overwritten.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href="/admin/asset-tracking"
              className="underline underline-offset-4 hover:text-navy"
            >
              ← Back to Asset Tracking
            </Link>
          </p>
        </header>

        {awbs.length === 0 ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              Open this log from an Allocated Asset count on the Asset Tracking
              report — it carries the AWB set to display.
            </p>
          </section>
        ) : lines.length === 0 ? (
          <section className="border border-[color:var(--color-border-strong)] px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              No scans recorded yet for {awbs.length} AWB{awbs.length === 1 ? "" : "s"}.
              History accumulates as scans sync.
            </p>
          </section>
        ) : (
          <DataTable
            columns={ASSET_LOG_COLUMNS}
            rows={lines}
            getRowKey={(line) =>
              `${line.trackingId}-${line.state}-${line.receivedAt}-${line.vendorScannedAt ?? ""}`
            }
            caption="Asset scan log, newest first"
          />
        )}
      </div>
    </main>
  );
}
