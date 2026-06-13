// Bag-tracking report helpers — Day-54 P2 (plan PR #502 §6).
//
// Pure helpers shared by the admin Asset Tracking report, both
// Inventory reports, and (P3) the Asset Log surface.

/**
 * Strict AWB shape — `MPL-12345678` style. Drill-down hrefs and the
 * tasks-page `?awbs=` parser both validate against this before any
 * value reaches SQL (the repository builds a pg array literal).
 */
export const AWB_PATTERN = /^[A-Z]{2,5}-\d{4,12}$/;

export function isValidAwb(awb: string): boolean {
  return AWB_PATTERN.test(awb);
}

/**
 * Parse a `?awbs=` query param into a validated AWB list. Silently
 * drops malformed entries (a hand-edited URL degrades to fewer
 * filters, never to an error page), de-duplicates, caps at 200
 * (the poll cap — symmetric upper bound for href length sanity).
 */
export function parseAwbsParam(raw: string | undefined): readonly string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const awb = part.trim();
    if (isValidAwb(awb)) seen.add(awb);
    if (seen.size >= 200) break;
  }
  return [...seen];
}

/**
 * Build a tasks-page drill-down href for an AWB set. Returns null for
 * an empty set — callers render a plain (unlinked) zero.
 */
export function awbsHref(
  basePath: string,
  awbs: readonly string[],
  extraParams: Readonly<Record<string, string>> = {},
): string | null {
  const valid = awbs.filter(isValidAwb);
  if (valid.length === 0) return null;
  const params = new URLSearchParams(extraParams);
  params.set("awbs", valid.join(","));
  return `${basePath}?${params.toString()}`;
}

/** Column-header tooltips — Aqib's confirmed semantics, verbatim. */
export const TOOLTIP_ALLOCATED = "Number of bags allocated to the AWB";
export const TOOLTIP_SUPP_QTY = "Number of ice packs";

/**
 * "As of" display. The timestamp is the most recent cache sync in
 * scope (the last successful poll or read-through refresh).
 */
export function formatAsOf(asOf: string | null): string {
  if (!asOf) return "No asset data yet";
  return `As of ${new Date(asOf).toUTCString().replace("GMT", "UTC")}`;
}

/**
 * "History since" note (plan Q7 accepted: no backfill exists — SF
 * exposes current state only, so the log accumulates from go-live).
 */
export function formatHistorySince(historySince: string | null): string {
  if (!historySince) return "History accumulates from first sync";
  return `History since ${new Date(historySince).toISOString().slice(0, 10)}`;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

function shiftDate(anchor: string, days: number): string {
  const d = new Date(`${anchor}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Page-boundary range parser shared by every report page: defaults
 * to the trailing 30 days, swaps inverted bounds, clamps the window
 * to 90 days (plan Q3 accepted — the clamp moves `from` up rather
 * than erroring on a hand-edited URL).
 */
export function parseReportRange(
  rawFrom: string | undefined,
  rawTo: string | undefined,
  today: string,
): { from: string; to: string } {
  let to = typeof rawTo === "string" && DATE_PATTERN.test(rawTo) ? rawTo : today;
  let from =
    typeof rawFrom === "string" && DATE_PATTERN.test(rawFrom)
      ? rawFrom
      : shiftDate(to, -DEFAULT_WINDOW_DAYS);
  if (from > to) [from, to] = [to, from];
  if (shiftDate(from, MAX_WINDOW_DAYS) < to) {
    from = shiftDate(to, -MAX_WINDOW_DAYS);
  }
  return { from, to };
}
