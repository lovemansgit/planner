// SuiteFleet LastMileAdapter assembly factory — Day 5 / T-8.
//
// Stitches the Day-4 primitives (S-1 through S-9) into a single
// constructable LastMileAdapter instance. Caller boots the adapter
// once at the module boundary and uses it everywhere.
//
// Primitives wired:
//   - createSuiteFleetAuthClient       (S-2)
//   - resolveSuiteFleetCredentials     (S-3) — supplied by caller as `deps.resolveCredentials`
//   - resolveSuiteFleetWebhookCredentials (S-3 webhook variant) — supplied as `deps.resolveWebhookCredentials`
//   - verifySuiteFleetWebhook          (S-4)
//   - parseSuiteFleetWebhookEvents     (S-5)
//   - mapSuiteFleetStatusToInternal    (S-6)
//   - createSuiteFleetTokenCache       (S-7)
//   - createSuiteFleetTaskClient       (S-8)
//
// -----------------------------------------------------------------------------
// Per-call task-client construction
// -----------------------------------------------------------------------------
// SuiteFleetTaskClient takes `clientId` at construction. clientId is
// per-tenant (lives on SuiteFleetCredentials). Building one task
// client at boot would bake in a single tenant's clientId; we'd need
// either a per-tenant client cache or per-call construction.
//
// We do per-call construction. Reasoning:
//   - The brief sample shows exactly this pattern ("resolve customerId
//     from credentials, call taskClient.createTask").
//   - For the Day-5 env-backed resolver, `resolveCredentials` is a
//     synchronous Map read with negligible cost.
//   - For Day-7+ Secrets Manager, the resolveCredentials side will
//     gain its own caching, so this code stays correct without change.
//
// Per-tenant client caching is a viable optimisation if Secrets
// Manager I/O cost ever becomes the bottleneck (filed as a Day-7+
// follow-up in the PR description, not implemented here).
//
// -----------------------------------------------------------------------------
// verifyWebhookRequest signature decision
// -----------------------------------------------------------------------------
// Per the T-8 design call, the LastMileAdapter interface for
// verifyWebhookRequest now takes `tenantId` as the first parameter
// and returns a Promise. Webhook verification is per-tenant
// (different webhook secrets per tenant), and an explicit parameter
// at the interface level is cleaner than capturing a defaultTenantId
// sentinel inside this factory's closure. The Day-4 single-tenant
// sentinel pattern (in src/app/api/webhooks/suitefleet/route.ts) is
// now legacy code that the dynamic-route variant replaces.

import { resolveSuiteFleetCredentials, resolveSuiteFleetWebhookCredentials } from "@/modules/credentials";
import type {
  SuiteFleetCredentials,
  SuiteFleetWebhookCredentials,
} from "@/modules/credentials";

import { createSuiteFleetAuthClient } from "./auth-client";
import { mapSuiteFleetStatusToInternal } from "./status-mapper";
import { createSuiteFleetTaskClient } from "./task-client";
import { createSuiteFleetTokenCache } from "./token-cache";
import { parseSuiteFleetWebhookEvents } from "./webhook-parser";
import { verifySuiteFleetWebhook } from "./webhook-verifier";

import type { LastMileAdapter } from "../../last-mile-adapter";
import type { Uuid } from "@/shared/types";

export interface SuiteFleetLastMileAdapterDeps {
  /** Injected for testability; production passes `globalThis.fetch`. */
  readonly fetch: typeof globalThis.fetch;
  /** Injected for testability; production passes `() => new Date()`. */
  readonly clock: () => Date;
  /**
   * Per-tenant SuiteFleet auth credentials (username/password/clientId/customerId).
   * Defaults to the canonical resolver. Override only in tests or when
   * a non-standard credential source is needed.
   */
  readonly resolveCredentials?: (tenantId: Uuid) => Promise<SuiteFleetCredentials>;
  /**
   * Per-tenant SuiteFleet webhook credentials (clientId/clientSecret).
   * Defaults to the canonical resolver. Override only in tests.
   */
  readonly resolveWebhookCredentials?: (tenantId: Uuid) => Promise<SuiteFleetWebhookCredentials>;
  /**
   * Optional override for the SuiteFleet base URL. Production reads
   * the per-environment value from env; tests pass the sandbox URL.
   * Forwarded to both the auth client and the per-call task client.
   */
  readonly baseUrl?: string;
}

/**
 * Construct a SuiteFleet implementation of `LastMileAdapter`. The
 * returned object is safe to share across requests — internal state
 * (the token cache) is per-tenant-keyed and concurrency-safe.
 */
export function createSuiteFleetLastMileAdapter(
  deps: SuiteFleetLastMileAdapterDeps,
): LastMileAdapter {
  const resolveCredentials = deps.resolveCredentials ?? resolveSuiteFleetCredentials;
  const resolveWebhookCredentials =
    deps.resolveWebhookCredentials ?? resolveSuiteFleetWebhookCredentials;

  const authClient = createSuiteFleetAuthClient({
    fetch: deps.fetch,
    clock: deps.clock,
    baseUrl: deps.baseUrl,
  });

  const tokenCache = createSuiteFleetTokenCache({
    authClient,
    resolveCredentials,
    clock: deps.clock,
  });

  return {
    async authenticate(tenantId) {
      return tokenCache.getSession(tenantId);
    },

    async refreshSession(session) {
      tokenCache.invalidate(session.tenantId);
      return tokenCache.getSession(session.tenantId);
    },

    async createTask(session, request) {
      // Per-call resolve to get customerId + clientId. See file
      // header for why this is per-call rather than cached.
      const credentials = await resolveCredentials(session.tenantId);
      const taskClient = createSuiteFleetTaskClient({
        fetch: deps.fetch,
        clock: deps.clock,
        clientId: credentials.clientId,
        baseUrl: deps.baseUrl,
      });
      return taskClient.createTask({
        session,
        customerId: credentials.customerId,
        request,
      });
    },

    async verifyWebhookRequest(tenantId, headers, body) {
      // body is unused by the SuiteFleet verifier (Client ID/Secret
      // header verification, not HMAC), but stays on the interface
      // for forward-compatibility with HMAC-style providers.
      void body;
      const credentials = await resolveWebhookCredentials(tenantId);
      return verifySuiteFleetWebhook(headers, credentials);
    },

    parseWebhookEvents(body) {
      // Composition per S-5's parser file header: "the adapter
      // assembly point composes the parser output with
      // mapStatusToInternal to populate internalStatus." The parser
      // intentionally leaves internalStatus undefined; this method
      // is where the composition lands.
      //
      // Implementation: pull each event's action from `raw` (the
      // original entry the parser preserved), call
      // mapSuiteFleetStatusToInternal, and merge into the event.
      // The mapper returns null for non-lifecycle actions (e.g.
      // TASK_HAS_BEEN_UPDATED is an edit, not a state change) — in
      // that case leave internalStatus undefined per the
      // LastMileAdapter.mapStatusToInternal contract documented in
      // last-mile-adapter.ts ("null means do not update the task's
      // state on this event").
      const events = parseSuiteFleetWebhookEvents(body);
      return events.map((event) => {
        if (typeof event.raw !== "object" || event.raw === null) return event;
        const action = (event.raw as Record<string, unknown>).action;
        if (typeof action !== "string") return event;
        const internalStatus = mapSuiteFleetStatusToInternal(action);
        if (internalStatus === null) return event;
        return { ...event, internalStatus };
      });
    },

    mapStatusToInternal(externalStatus) {
      return mapSuiteFleetStatusToInternal(externalStatus);
    },
  };
}
