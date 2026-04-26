// src/app/hello/page.tsx
//
// First-day deliverable per plan §11.6 — proves the platform's external
// dependencies are wired up and reachable. If any panel below is red,
// day 2 does not start (§11.6 closing line).
//
// =============================================================================
// DEVIATION FROM §11.6 (approved by Love in commit-10 prep, 2026-04-26)
// -----------------------------------------------------------------------------
// §11.6 lists FIVE items: (1) git commit SHA, (2) Supabase, (3) Upstash
// Redis, (4) AWS Secrets Manager, (5) SuiteFleet sandbox. The morning
// handoff brief reframed this composition — git SHA becomes DISPLAY
// METADATA (not counted as a ping) and Sentry is added as the fifth
// SERVICE panel. Net effect: still five "all-green-or-day-2-doesn't-start"
// service panels, just with Sentry in git SHA's slot in the count.
//
// Two of the five panels are intentionally LIGHTER than full "ping"
// semantics — both are documented at their respective check functions:
//   - Sentry        (full SDK wiring is a Day-9 deliverable per §10.2)
//   - SuiteFleet    (login endpoint TBD until Day 4 per ADR-007)
// Each upgrades to a true ping when its source-of-truth check lands.
// =============================================================================

import "server-only";
import { sql as sqlTag } from "drizzle-orm";
import { Redis } from "@upstash/redis";
import { SecretsManagerClient, ListSecretsCommand } from "@aws-sdk/client-secrets-manager";
import { withServiceRole } from "@/shared/db";

// Force dynamic rendering — pings must run on every request, not at
// build time. Without this, Next.js 16 would attempt to statically
// pre-render the page and the ping results would freeze at deploy time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PanelResult {
  name: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

async function pingSupabase(): Promise<PanelResult> {
  const start = Date.now();
  try {
    // withServiceRole because (a) we have no tenant context yet and
    // (b) this is purely a connection-health check, not business data.
    await withServiceRole("hello-page Supabase ping", async (tx) => {
      await tx.execute(sqlTag`SELECT 1`);
    });
    return { name: "Supabase", ok: true, message: "SELECT 1 returned OK", durationMs: Date.now() - start };
  } catch (e) {
    return {
      name: "Supabase",
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

async function pingUpstashRedis(): Promise<PanelResult> {
  const start = Date.now();
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    const reply = await redis.ping();
    const ok = reply === "PONG";
    return {
      name: "Upstash Redis",
      ok,
      message: ok ? "PING returned PONG" : `Unexpected reply: ${reply}`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      name: "Upstash Redis",
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

async function pingAwsSecretsManager(): Promise<PanelResult> {
  const start = Date.now();
  // Symmetry with the Sentry / SuiteFleet env guards: surface a missing
  // env var as a clear-message red panel rather than letting the AWS SDK
  // throw "region is missing" deep in its initialization path.
  const region = process.env.AWS_REGION;
  if (!region) {
    return {
      name: "AWS Secrets Manager",
      ok: false,
      message: "AWS_REGION is not set",
      durationMs: Date.now() - start,
    };
  }
  try {
    const client = new SecretsManagerClient({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    // ListSecrets with MaxResults: 1 verifies IAM + reachability without
    // depending on a specific secret existing — none exist yet at this
    // point in the pilot. §11.6: "not fetching any actual secret, just
    // testing IAM."
    const reply = await client.send(new ListSecretsCommand({ MaxResults: 1 }));
    return {
      name: "AWS Secrets Manager",
      ok: true,
      message: `ListSecrets returned (count=${reply.SecretList?.length ?? 0})`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return {
      name: "AWS Secrets Manager",
      ok: false,
      message: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

// Sentry DSN format: https://<32-hex>@<host>/<numeric-project-id>
// Format as of Sentry SDK v10. If Sentry changes the DSN spec, this regex
// needs updating — the failure mode is a false-red panel, not data loss.
const SENTRY_DSN_REGEX = /^https:\/\/[a-f0-9]+@[a-z0-9.-]+\/\d+$/i;

async function pingSentry(): Promise<PanelResult> {
  const start = Date.now();
  // ===========================================================================
  // DEVIATION FROM "ping" SEMANTICS (deliberate, approved):
  // Full Sentry SDK init + a test event would prove Sentry is fully
  // operational — but Sentry SDK wiring is a Day-9 deliverable per plan
  // §10.2 ("Claude Code: Sentry wiring for the batch (error capture +
  // performance traces)"). Until then this panel only verifies that the
  // DSN env var is present and parses as a valid Sentry DSN. The Day-9
  // commit upgrades this panel to a true SDK-init + test-event check.
  //
  // Two-layer validation: regex (fast structural check) AND new URL()
  // (catches malformed values that happen to regex-match but don't
  // actually parse — trailing whitespace, encoded characters, etc).
  // Both must pass.
  // ===========================================================================
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    return {
      name: "Sentry",
      ok: false,
      message: "NEXT_PUBLIC_SENTRY_DSN is not set",
      durationMs: Date.now() - start,
    };
  }
  if (!SENTRY_DSN_REGEX.test(dsn)) {
    return {
      name: "Sentry",
      ok: false,
      message: "DSN does not match Sentry format",
      durationMs: Date.now() - start,
    };
  }
  try {
    new URL(dsn);
  } catch {
    return {
      name: "Sentry",
      ok: false,
      message: "DSN is not a parseable URL",
      durationMs: Date.now() - start,
    };
  }
  return {
    name: "Sentry",
    ok: true,
    message: "DSN configured and parseable (full SDK init lands Day 9)",
    durationMs: Date.now() - start,
  };
}

async function pingSuiteFleetSandbox(): Promise<PanelResult> {
  const start = Date.now();
  // ===========================================================================
  // DEVIATION FROM "ping" SEMANTICS (deliberate, approved):
  // §11.6 calls for a SuiteFleet ping "using a dummy credential" — but
  // ADR-007 specifies SuiteFleet uses username/password JWT auth, and the
  // exact login endpoint path is TBD until Day 4 of the sprint. Until
  // that endpoint is verified no auth call can be made.
  //
  // This panel does an UNAUTHENTICATED HEAD against the sandbox base URL
  // with a 5-second timeout. The check is DNS + TLS reachability ONLY —
  // any response that completes the TLS handshake is GREEN, INCLUDING
  // 404 / 405. The point is "the host is reachable from this network,"
  // not "this endpoint exists" or "this credential is valid." The Day-4
  // adapter commit upgrades this panel to a real auth-roundtrip check.
  // ===========================================================================
  const baseUrl = process.env.SUITEFLEET_SANDBOX_API_BASE_URL;
  if (!baseUrl) {
    return {
      name: "SuiteFleet sandbox",
      ok: false,
      message: "SUITEFLEET_SANDBOX_API_BASE_URL is not set",
      durationMs: Date.now() - start,
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const reply = await fetch(baseUrl, { method: "HEAD", signal: controller.signal });
    clearTimeout(timeout);
    return {
      name: "SuiteFleet sandbox",
      ok: true,
      message: `HEAD ${baseUrl} → HTTP ${reply.status} (TLS reachable)`,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg =
      e instanceof Error
        ? e.name === "AbortError"
          ? "timed out after 5s"
          : e.message
        : String(e);
    return {
      name: "SuiteFleet sandbox",
      ok: false,
      message: msg,
      durationMs: Date.now() - start,
    };
  }
}

export default async function HelloPage() {
  // Run all five pings in parallel — page wall-time is bounded by the
  // slowest panel, not the sum.
  const panels = await Promise.all([
    pingSupabase(),
    pingUpstashRedis(),
    pingAwsSecretsManager(),
    pingSentry(),
    pingSuiteFleetSandbox(),
  ]);

  // Vercel injects VERCEL_GIT_COMMIT_SHA on every deploy; locally it's
  // unset, so fall back to a clear placeholder. NOT counted as a panel
  // per the §11.6 deviation noted at the top of this file.
  const gitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? "(local — VERCEL_GIT_COMMIT_SHA not set)";
  const allGreen = panels.every((p) => p.ok);

  return (
    <main className="mx-auto max-w-3xl p-8 font-mono">
      <h1 className="mb-2 text-2xl font-semibold">Subscription Planner — /hello</h1>
      <p className="mb-1 text-sm text-neutral-600">
        First-day deliverable per plan §11.6.{" "}
        <strong>If any panel below is red, day 2 does not start.</strong>
      </p>
      <p className="mb-6 text-sm text-neutral-600">
        commit:&nbsp;<code data-testid="git-sha">{gitSha}</code>
      </p>
      <div data-testid="hello-panels" data-all-green={allGreen ? "true" : "false"}>
        {panels.map((panel) => (
          <div
            key={panel.name}
            data-testid="hello-panel"
            data-panel-name={panel.name}
            data-panel-ok={panel.ok ? "true" : "false"}
            className={
              panel.ok
                ? "mb-3 rounded-md border-2 border-green-700 bg-green-50 px-4 py-3"
                : "mb-3 rounded-md border-2 border-red-700 bg-red-50 px-4 py-3"
            }
          >
            <div className="flex items-baseline justify-between">
              <strong>{panel.name}</strong>
              <span className={panel.ok ? "text-green-700" : "text-red-700"}>
                {panel.ok ? "● GREEN" : "● RED"}
              </span>
            </div>
            <div className="mt-1 text-sm text-neutral-700">{panel.message}</div>
            <div className="text-xs text-neutral-500">{panel.durationMs}ms</div>
          </div>
        ))}
      </div>
    </main>
  );
}
