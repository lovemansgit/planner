// /admin/failed-pushes — Day 8 / D8-5
//
// Server component. Lists unresolved failed_pushes rows for the
// requesting tenant; the client-side retry surface is a child component
// (FailedPushesAdmin) imported from ./client.tsx.
//
// Permission boundary: the `listUnresolvedFailedPushes` service call
// gates on `failed_pushes:retry` — same permission that gates the
// retry write. Tenant Admin holds it via TENANT_SCOPED auto-pickup;
// CS Agent does NOT. A CS Agent reaching this URL gets a 403 from the
// service layer (rendered as a NextJS error boundary).
//
// Brand language (matches Z-1 brand tokens, mirrors /subscriptions
// page architecture):
//   - Background:   var(--color-surface-primary)   (warm off-white)
//   - Foreground:   var(--color-navy)              (deep navy)
//   - Tints:        var(--color-text-{secondary|tertiary})
//                   var(--color-border-{default|strong})
//   - Hero numeral for the unresolved-count headline (serif Sanchez)
//   - Sentence case throughout, 0.5px hairline borders, no shadows

import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import {
  listUnresolvedFailedPushes,
  type FailedPush,
} from "@/modules/failed-pushes";
import { NoTenantConfiguredError, UnauthorizedError } from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";

import { FailedPushesAdmin } from "./client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function FailedPushesAdminPage() {
  const requestId = randomUUID();

  let rows: readonly FailedPush[];
  try {
    const ctx = await buildRequestContext("/admin/failed-pushes", requestId);
    rows = await listUnresolvedFailedPushes(ctx);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect("/login?next=" + encodeURIComponent("/admin/failed-pushes"));
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-6xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Operations · DLQ
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Failed pushes</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Unresolved task pushes that hit the dead-letter queue. Retry one or many; bulk retry
            paces at 5 requests per second so SuiteFleet doesn&apos;t get hammered.
          </p>
        </header>

        <section className="mb-16 border-t border-b border-[color:var(--color-border-strong)] py-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Unresolved rows
          </p>
          <p className="mt-4 font-serif text-7xl font-light tabular-nums leading-none">
            {rows.length}
          </p>
        </section>

        {rows.length === 0 ? <EmptyState /> : <FailedPushesAdmin initialRows={rows} />}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="border-t border-b border-[color:var(--color-border-strong)] py-16 text-center">
      <p className="text-base text-navy">No unresolved failed pushes.</p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        New failures land here automatically when the cron writes a DLQ row.
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Operations · DLQ
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before opening the admin views.
        </p>
      </div>
    </main>
  );
}
