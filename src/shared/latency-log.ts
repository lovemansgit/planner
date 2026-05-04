// Day 12 — transient latency instrumentation for the /tasks investigation.
//
// Gated behind ENABLE_LATENCY_LOGS=1 so logs never ship to production by
// accident. Set the env var in Vercel Preview scope, run /tasks, collect
// the [TASKS-LATENCY] lines from Vercel function logs, then remove this
// file (and its callers in src/shared/request-context.ts +
// src/app/(app)/tasks/page.tsx) once the dominant cost is identified.
//
// Stable line shape — `[TASKS-LATENCY] label=<duration>ms {extra-json}`
// — so reviewer can grep across a request's logs deterministically.

export function isLatencyLogEnabled(): boolean {
  return process.env.ENABLE_LATENCY_LOGS === "1";
}

export function logLatency(
  label: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  if (!isLatencyLogEnabled()) return;
  const payload = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  // Single line per measurement; reviewer greps `[TASKS-LATENCY]`.
  console.log(`[TASKS-LATENCY] ${label}=${durationMs.toFixed(1)}ms${payload}`);
}

/**
 * Wrap an async function with start/end timing. No-op (returns the
 * inner promise unchanged) when ENABLE_LATENCY_LOGS is unset — zero
 * production cost beyond the env-var read.
 *
 * Errors propagate; the timing line for an error path includes
 * `error: <message>` so the reviewer can distinguish failed vs
 * succeeded measurements.
 */
export async function measure<T>(
  label: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>,
): Promise<T> {
  if (!isLatencyLogEnabled()) return fn();
  const start = performance.now();
  try {
    const result = await fn();
    logLatency(label, performance.now() - start, extra);
    return result;
  } catch (err) {
    logLatency(label, performance.now() - start, {
      ...extra,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
