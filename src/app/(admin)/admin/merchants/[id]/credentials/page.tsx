// Day 26 / T3 Sub-PR 3 — Per-merchant credentials page (server component).
//
// Write-only by design per brief §3.7 — the page MUST NOT fetch
// decrypted_secret and MUST NOT show partial/masked previews. Any echo
// path becomes a privilege-escalation vector if the page itself is
// misconfigured later. The read path here only:
//   - Asserts merchant:update on the actor (loadCredentialsPageState
//     internal gate; redundant page-level requirePermission for the
//     UX-symmetry guard with the action layer)
//   - Loads the merchant name + region.auth_method + has-credentials
//     boolean via loadCredentialsPageState (one JOIN'd SQL trip)
//
// The form's field labels branch on auth_method (v1.15 amendment §8.1);
// the submit-button label and rotate confirm modal branch on the
// has-credentials boolean (initial-set vs rotation).
//
// Notable: this page intentionally does NOT call findRegionForMerchant
// or getMerchantById — loadCredentialsPageState collapses both into one
// query while exposing only the SAFE-FOR-RENDER fields.

import { randomUUID } from "node:crypto";

import { notFound, redirect } from "next/navigation";

import {
  loadCredentialsPageState,
  type CredentialsPageState,
} from "@/modules/credentials";
import { requirePermission } from "@/modules/identity";
import {
  ForbiddenError,
  NoTenantConfiguredError,
  NotFoundError,
  UnauthorizedError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { CredentialsForm } from "./_components/CredentialsForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface CredentialsPageProps {
  readonly params: Promise<{
    readonly id: string;
  }>;
}

export default async function CredentialsPage({ params }: CredentialsPageProps) {
  const { id } = await params;
  const requestId = randomUUID();

  let state: CredentialsPageState;
  try {
    const ctx = await buildRequestContext(
      `/admin/merchants/${id}/credentials`,
      requestId,
    );
    // Page-level permission preflight (same gate the action enforces) —
    // defense-in-depth so an actor without merchant:update gets the
    // redirect rather than rendering an empty form and 403'ing on
    // submit.
    requirePermission(ctx, "merchant:update");
    state = await loadCredentialsPageState(ctx, id as Uuid);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(
        "/login?next=" + encodeURIComponent(`/admin/merchants/${id}/credentials`),
      );
    }
    if (err instanceof ForbiddenError) {
      redirect("/");
    }
    if (err instanceof NotFoundError) {
      notFound();
    }
    if (err instanceof NoTenantConfiguredError) {
      return <SystemNotInitialised />;
    }
    throw err;
  }

  const eyebrow = state.hasCredentials
    ? "Rotate credentials"
    : "Set credentials";

  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin · {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{state.merchantName}</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Region: <span className="font-medium text-navy">{state.region.displayName}</span> ·
            authentication method:{" "}
            <span className="font-medium text-navy">
              {state.region.authMethod === "oauth" ? "OAuth" : "API Key"}
            </span>
          </p>
        </header>

        <CredentialsForm
          tenantId={state.tenantId}
          merchantName={state.merchantName}
          authMethod={state.region.authMethod}
          hasCredentials={state.hasCredentials}
        />
      </div>
    </main>
  );
}

function SystemNotInitialised() {
  return (
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-32 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
          Transcorp · Admin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">System not yet initialised</h1>
        <p className="mt-6 text-sm text-[color:var(--color-text-secondary)]">
          No tenants are configured. Onboard at least one tenant before using the admin views.
        </p>
      </div>
    </main>
  );
}
