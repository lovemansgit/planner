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
import { getAssetScanLog } from "@/modules/asset-tracking/report-service";
import type { AssetLogLine } from "@/modules/asset-tracking/report-service";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TH = "px-4 py-3 text-left text-xs uppercase tracking-[0.15em] text-[color:var(--color-text-secondary)]";
const TD = "px-4 py-3 text-sm";

function formatScanTime(line: AssetLogLine): { time: string; recorded: boolean } {
  const iso = line.vendorScannedAt ?? line.receivedAt;
  const time = new Date(iso).toUTCString().replace("GMT", "UTC");
  return { time, recorded: line.vendorScannedAt === null };
}

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
      <div className="mx-auto max-w-6xl px-12 py-16">
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
          <div className="overflow-x-auto border border-[color:var(--color-border-strong)]">
            <table className="w-full border-collapse">
              <thead className="border-b border-[color:var(--color-border-strong)] bg-[color:var(--color-tint-navy-subtle)]">
                <tr>
                  <th className={TH}>Scan time</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Package</th>
                  <th className={TH}>AWB</th>
                  <th className={TH}>Scanned by</th>
                  <th className={TH}>Merchant</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const { time, recorded } = formatScanTime(line);
                  return (
                    <tr
                      key={`${line.trackingId}-${line.state}-${line.receivedAt}-${i}`}
                      className="border-b border-[color:var(--color-border-default)] last:border-b-0"
                    >
                      <td className={`${TD} tabular-nums`}>
                        {time}
                        {recorded ? (
                          <span
                            className="ml-2 text-xs text-[color:var(--color-text-secondary)]"
                            title="SuiteFleet does not provide scanner timestamps yet; this is when Planner recorded the scan."
                          >
                            recorded in Planner
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD} font-medium`}>{line.state.replace("_", " ")}</td>
                      <td className={`${TD} tabular-nums`}>{line.trackingId}</td>
                      <td className={`${TD} tabular-nums`}>{line.awb}</td>
                      <td className={TD}>{line.scannedByName ?? "—"}</td>
                      <td className={TD}>{line.merchantName}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
