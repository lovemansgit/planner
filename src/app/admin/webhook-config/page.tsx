// /admin/webhook-config — Day 9 / P4a
//
// Server component. Renders the per-tenant inbound webhook
// configuration page: URL display + Tier-2 mismatch metrics.
//
// Permission boundary: queries gate on `webhook_config:read`. Tenant
// Admin holds it via TENANT_SCOPED auto-pickup; Ops Manager via
// explicit-list addition (see roles.ts). CS Agent does NOT — a CS
// Agent reaching this URL gets a 403 from the queries layer (rendered
// as a NextJS error boundary).
//
// Brand language matches /admin/failed-pushes (D8-5 precedent):
//   - Background:   var(--color-surface-primary)   (warm off-white)
//   - Foreground:   var(--color-navy)              (deep navy)
//   - Tints:        var(--color-text-{secondary|tertiary})
//                   var(--color-border-{default|strong})
//   - Hero numeral for mismatch count (serif Sanchez)
//   - Sentence case throughout, 0.5px hairline borders, no shadows

import { randomUUID } from "node:crypto";

import {
  buildWebhookUrl,
  countTier2MismatchesLast24h,
  resolvePublicBaseUrl,
  tier2CredentialsConfigured,
  type Tier2MismatchSummary,
} from "@/modules/webhooks";
import { buildDemoContext } from "@/shared/demo-context";
import { NoTenantConfiguredError } from "@/shared/errors";

import { CopyableUrl } from "./client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WebhookConfigPage() {
  const requestId = randomUUID();

  let webhookUrl: string;
  let mismatchSummary: Tier2MismatchSummary;
  let tier2Configured: boolean;
  try {
    const ctx = await buildDemoContext("/admin/webhook-config", requestId);
    // buildDemoContext throws NoTenantConfiguredError when the tenants
    // table is empty, so by this point ctx.tenantId is non-null in
    // practice. The defensive check satisfies the type narrow without
    // putting JSX inside try (lint rule react-hooks/error-boundaries).
    if (!ctx.tenantId) {
      throw new NoTenantConfiguredError();
    }
    const baseUrl = resolvePublicBaseUrl();
    webhookUrl = buildWebhookUrl(ctx.tenantId, baseUrl);
    [mismatchSummary, tier2Configured] = await Promise.all([
      countTier2MismatchesLast24h(ctx),
      tier2CredentialsConfigured(ctx),
    ]);
  } catch (err) {
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-4xl px-12 py-16">
        <header className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Operations · Integrations
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Webhook configuration</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Inbound webhook receiver for SuiteFleet task lifecycle events. The URL below is
            paired with this tenant — paste it into your SuiteFleet portal&apos;s webhook
            configuration to start receiving updates.
          </p>
        </header>

        {/* URL display */}
        <section className="mb-16 border-t border-b border-[color:var(--color-border-strong)] py-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Receiver URL
          </p>
          <div className="mt-6">
            <CopyableUrl url={webhookUrl} />
          </div>
          <p className="mt-4 text-xs text-[color:var(--color-text-tertiary)]">
            URL above reflects current deploy environment. For Production, use the value displayed
            at planner-olive-sigma.vercel.app.
          </p>
        </section>

        {/* Verification chain explainer */}
        <section className="mb-16">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            How verification works
          </p>
          <div className="mt-6 space-y-4 text-sm text-navy">
            <p>
              <span className="font-semibold">Tier 1 (default).</span> Receiver verifies the URL
              matches an active tenant and that the body conforms to SuiteFleet&apos;s known
              shape. Most webhooks land here.
            </p>
            <p>
              <span className="font-semibold">Tier 2 (opt-in).</span> If your SuiteFleet portal
              has Client ID / Secret configured AND those credentials are seeded in the planner,
              the receiver also verifies header credentials via timing-safe comparison.
              Coming soon: credential management. Contact operations to enable Tier-2 verification
              today.
            </p>
            <p className="text-[color:var(--color-text-secondary)]">
              Receiver activity for this tenant is shown below.
            </p>
          </div>
        </section>

        {/* Tier-2 mismatch metrics */}
        <section className="mb-16 border-t border-b border-[color:var(--color-border-strong)] py-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Tier-2 status
          </p>
          {tier2Configured ? (
            <Tier2ConfiguredPanel count={mismatchSummary.count} />
          ) : (
            <Tier2NotConfiguredPanel />
          )}
        </section>

        <p className="mt-12 text-xs text-[color:var(--color-text-tertiary)]">
          Other receiver metrics (last received-at, success counts, error reasons) require
          receiver-side persistence and are deferred to a future commit.
        </p>
      </div>
    </main>
  );
}

function Tier2ConfiguredPanel({ count }: { readonly count: number }) {
  const status = count === 0 ? "ok" : "warn";
  const colorClass =
    status === "ok"
      ? "text-[color:var(--color-text-secondary)]"
      : "text-navy";

  return (
    <div className="mt-6">
      <p className="text-sm text-[color:var(--color-text-secondary)]">
        Credentials configured — receiver runs Tier-2 verification on inbound webhooks.
      </p>
      <p className="mt-6 text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
        Credential mismatches (last 24h)
      </p>
      <p
        className={`mt-3 font-serif text-7xl font-light tabular-nums leading-none ${colorClass}`}
      >
        {count}
      </p>
      {count > 0 && (
        <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
          A mismatch means the inbound headers did not match stored credentials. If unexpected,
          rotate the credentials in your SuiteFleet portal AND in the planner (rotation flow
          coming soon).
        </p>
      )}
    </div>
  );
}

function Tier2NotConfiguredPanel() {
  return (
    <div className="mt-6">
      <p className="text-sm text-[color:var(--color-text-secondary)]">
        Tier-2 not configured for this tenant. Receiver runs Tier-1 verification only (tenant
        identity + payload shape). No credential mismatches are possible.
      </p>
      <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
        To enable Tier-2: configure Client ID / Secret in your SuiteFleet portal AND contact
        operations to seed the same values in the planner. (Self-serve credential management
        coming soon.)
      </p>
    </div>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Operations · Integrations
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before opening the admin views.
        </p>
      </div>
    </main>
  );
}
