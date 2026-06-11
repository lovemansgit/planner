// Supabase Storage implementation of PodObjectStore — REST, no SDK.
//
// Three documented endpoints under {SUPABASE_URL}/storage/v1, all
// authorized with the service-role key (server-only; the browser never
// sees the bucket — bytes go out through the POD proxy route's
// task:read gate):
//   POST /bucket                       — create (409/400 "exists" = ok)
//   POST /object/{bucket}/{path}       — upload (x-upsert for retries)
//   GET  /object/{bucket}/{path}       — download
//
// The bucket is PRIVATE (public:false) — objects are unreachable
// without the service role; the proxy is the only read path.

import "server-only";

import type { PodObjectStore } from "./types";

export const POD_BUCKET = "pod-photos";

export interface SupabasePodObjectStoreDeps {
  readonly fetch: typeof globalThis.fetch;
  /** Defaults to NEXT_PUBLIC_SUPABASE_URL. */
  readonly baseUrl?: string;
  /** Defaults to SUPABASE_SERVICE_ROLE_KEY. */
  readonly serviceRoleKey?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var required for the POD object store`);
  }
  return value;
}

export function createSupabasePodObjectStore(
  deps: SupabasePodObjectStoreDeps,
): PodObjectStore {
  const baseUrl = (deps.baseUrl ?? requireEnv("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/+$/, "");
  const key = deps.serviceRoleKey ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const authHeaders = { Authorization: `Bearer ${key}`, apikey: key } as const;

  return {
    async ensureBucket(): Promise<void> {
      const res = await deps.fetch(`${baseUrl}/storage/v1/bucket`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ id: POD_BUCKET, name: POD_BUCKET, public: false }),
      });
      if (res.ok) return;
      // "Bucket already exists" comes back 400/409 depending on
      // gateway version — both mean the invariant holds.
      const body = await res.text();
      if ((res.status === 400 || res.status === 409) && /exist/i.test(body)) return;
      throw new Error(`pod store ensureBucket failed: ${res.status} ${body.slice(0, 200)}`);
    },

    async put(path: string, bytes: ArrayBuffer, contentType: string): Promise<void> {
      const res = await deps.fetch(
        `${baseUrl}/storage/v1/object/${POD_BUCKET}/${path}`,
        {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": contentType,
            // Upsert so a QStash retry after a partial failure
            // overwrites cleanly instead of 409ing.
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`pod store put failed: ${res.status} ${body.slice(0, 200)}`);
      }
    },

    async get(path: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
      const res = await deps.fetch(
        `${baseUrl}/storage/v1/object/${POD_BUCKET}/${path}`,
        { headers: { ...authHeaders } },
      );
      if (res.status === 400 || res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`pod store get failed: ${res.status} ${body.slice(0, 200)}`);
      }
      return {
        bytes: await res.arrayBuffer(),
        contentType: res.headers.get("content-type") ?? "image/jpeg",
      };
    },
  };
}
