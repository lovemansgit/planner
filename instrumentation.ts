// Next.js App Router instrumentation entrypoint.
//
// Called by Next.js once per process at startup, dispatched by runtime.
// Day 7 / C-6 wires Sentry init for both Node and Edge — the Edge
// branch is currently inert (no Edge routes) but stays present so
// future Edge usage initialises Sentry consistently.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Sentry's @sentry/nextjs v10 captures unhandled errors in server-side
// React Server Components via this hook. The export is a thin alias —
// no custom transformation; Sentry handles the rest.
export const onRequestError = async (...args: unknown[]): Promise<void> => {
  const Sentry = await import("@sentry/nextjs");
  // Sentry's typing expects (err, request, errorContext). Passing through
  // the raw args avoids re-declaring the framework's interface here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Sentry as unknown as { captureRequestError: (...a: any[]) => void }).captureRequestError(
    ...args,
  );
};
