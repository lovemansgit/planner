// tests/integration/pod-capture.spec.ts
// =============================================================================
// Day-53 EVE — durable POD photo capture (plan
// memory/plans/day-53-durable-pod-photo-storage.md §4, cleared #413).
// Real Postgres; the object store and the upstream photo fetch are
// injected fakes (the only boundaries that would otherwise hit the
// network).
//
// Cases pinned:
//   1. Happy path — capture fetches each pod_photos URL within TTL,
//      stores bytes at pod-photos/{tenant}/{task}/{index}, records the
//      index-aligned entries (path/bytes/content_type) on
//      tasks.pod_photo_captures.
//   2. Idempotency — second run is a no-op (no re-fetch, no re-store).
//   3. Upstream failure → throws (QStash retry/DLQ owns it); nothing
//      partial is recorded.
//   4. Proxy preference — getCapturedPodPhoto returns stored bytes for
//      a captured index (task:read gated; Forbidden without it),
//      null when nothing captured (route falls back to the vendor URL).
//   5. Free-tier guardrail — classifyFreeTierUsage thresholds + the
//      post-capture sum sees the recorded bytes. Log-and-alert only,
//      NEVER a drop: capture succeeds even at 'critical'.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withServiceRole, withTenant } from "../../src/shared/db";
import { ForbiddenError } from "../../src/shared/errors";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

import {
  capturePodPhotosForTask,
  classifyFreeTierUsage,
  getCapturedPodPhoto,
  sumCapturedPodBytes,
} from "../../src/modules/pod-capture";
import type { PodObjectStore } from "../../src/modules/pod-capture";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT = randomUUID() as Uuid;
const SLUG = `podcap-${RUN_ID}`;
const CONSIGNEE = randomUUID() as Uuid;
const ADDRESS = randomUUID() as Uuid;
const TASK_HAPPY = randomUUID() as Uuid;
const TASK_FAIL = randomUUID() as Uuid;
const TASK_BARE = randomUUID() as Uuid;

const PHOTO_1 = `https://sf.example/pod/${RUN_ID}/a.jpg?sig=1`;
const PHOTO_2 = `https://sf.example/pod/${RUN_ID}/b.png?sig=2`;

function ctxWith(perms: readonly Permission[]): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: randomUUID(),
      tenantId: TENANT,
      permissions: new Set(perms),
    },
    tenantId: TENANT,
    requestId: `podcap-${RUN_ID}`,
    path: "/api/test",
  } as RequestContext;
}

function makeFakeStore(): PodObjectStore & {
  readonly objects: Map<string, { bytes: ArrayBuffer; contentType: string }>;
  putCalls: number;
} {
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>();
  const store = {
    objects,
    putCalls: 0,
    async ensureBucket() {},
    async put(path: string, bytes: ArrayBuffer, contentType: string) {
      store.putCalls += 1;
      objects.set(path, { bytes, contentType });
    },
    async get(path: string) {
      return objects.get(path) ?? null;
    },
  };
  return store;
}

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function makeFakeUpstream(
  map: Record<string, { status: number; body: string; contentType: string }>,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const entry = map[url];
    if (!entry) return new Response("not mapped", { status: 599 });
    return new Response(entry.body, {
      status: entry.status,
      headers: { "content-type": entry.contentType },
    });
  }) as typeof globalThis.fetch;
}

describe("Day-53 — durable POD capture (real Postgres, fake store/upstream)", () => {
  beforeAll(async () => {
    await withServiceRole("podcap seed", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status)
        VALUES (${TENANT}, ${SLUG}, 'PodCap Test', 'active')
      `);
      await tx.execute(sqlTag`
        INSERT INTO consignees (id, tenant_id, name, email, phone,
          address_line, emirate_or_region, district)
        VALUES (${CONSIGNEE}, ${TENANT}, 'PodCap Consignee', 'cons@podcap.test',
                '+971500000097', 'Test Line', 'Dubai', 'Test District')
      `);
      await tx.execute(sqlTag`
        INSERT INTO addresses (id, tenant_id, consignee_id, label, is_primary, line, district, emirate)
        VALUES (${ADDRESS}, ${TENANT}, ${CONSIGNEE},
                'home', true, 'Test Line', 'Test District', 'Dubai')
      `);
      await tx.execute(sqlTag`
        INSERT INTO tasks (
          id, tenant_id, consignee_id, created_via, customer_order_number,
          internal_status, delivery_date, delivery_start_time, delivery_end_time,
          address_id, pod_photos
        ) VALUES
          (${TASK_HAPPY}, ${TENANT}, ${CONSIGNEE}, 'manual_admin', ${`POD-${RUN_ID}-H`},
           'DELIVERED', CURRENT_DATE, '09:00:00', '18:00:00', ${ADDRESS},
           ${JSON.stringify([PHOTO_1, PHOTO_2])}::jsonb),
          (${TASK_FAIL}, ${TENANT}, ${CONSIGNEE}, 'manual_admin', ${`POD-${RUN_ID}-F`},
           'DELIVERED', CURRENT_DATE, '09:00:00', '18:00:00', ${ADDRESS},
           ${JSON.stringify([PHOTO_1])}::jsonb),
          (${TASK_BARE}, ${TENANT}, ${CONSIGNEE}, 'manual_admin', ${`POD-${RUN_ID}-B`},
           'DELIVERED', CURRENT_DATE, '09:00:00', '18:00:00', ${ADDRESS}, NULL)
      `);
    });
  });

  it("case 1 — captures every photo, records index-aligned entries", async () => {
    const store = makeFakeStore();
    const upstream = makeFakeUpstream({
      [PHOTO_1]: { status: 200, body: "JPEGBYTES-A", contentType: "image/jpeg" },
      [PHOTO_2]: { status: 200, body: "PNGBYTES-BB", contentType: "image/png" },
    });

    const result = await capturePodPhotosForTask(
      { tenant_id: TENANT, task_id: TASK_HAPPY, correlation_id: `corr-${RUN_ID}` },
      { store, fetch: upstream },
    );
    expect(result.outcome).toBe("captured");
    if (result.outcome !== "captured") return;
    expect(result.capturedCount).toBe(2);

    const rows = await withTenant(TENANT, async (tx) =>
      tx.execute<{ pod_photo_captures: readonly Record<string, unknown>[] }>(sqlTag`
        SELECT pod_photo_captures FROM tasks WHERE id = ${TASK_HAPPY}
      `),
    );
    const entries = rows[0].pod_photo_captures;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      path: `${TENANT}/${TASK_HAPPY}/0.jpg`,
      bytes: 11,
      content_type: "image/jpeg",
    });
    expect(entries[1]).toEqual({
      path: `${TENANT}/${TASK_HAPPY}/1.png`,
      bytes: 11,
      content_type: "image/png",
    });
    expect(store.objects.has(`${TENANT}/${TASK_HAPPY}/0.jpg`)).toBe(true);
    expect(store.objects.has(`${TENANT}/${TASK_HAPPY}/1.png`)).toBe(true);
  });

  it("case 2 — second run is an idempotent no-op", async () => {
    const store = makeFakeStore();
    const upstream = makeFakeUpstream({});
    const result = await capturePodPhotosForTask(
      { tenant_id: TENANT, task_id: TASK_HAPPY, correlation_id: `corr2-${RUN_ID}` },
      { store, fetch: upstream },
    );
    expect(result.outcome).toBe("already_captured");
    expect(store.putCalls).toBe(0);
  });

  it("case 3 — upstream failure throws; nothing partial recorded", async () => {
    const store = makeFakeStore();
    const upstream = makeFakeUpstream({
      [PHOTO_1]: { status: 403, body: "Request has expired", contentType: "application/xml" },
    });
    await expect(
      capturePodPhotosForTask(
        { tenant_id: TENANT, task_id: TASK_FAIL, correlation_id: `corr3-${RUN_ID}` },
        { store, fetch: upstream },
      ),
    ).rejects.toThrow(/upstream 403/);

    const rows = await withTenant(TENANT, async (tx) =>
      tx.execute<{ pod_photo_captures: unknown }>(sqlTag`
        SELECT pod_photo_captures FROM tasks WHERE id = ${TASK_FAIL}
      `),
    );
    expect(rows[0].pod_photo_captures).toBeNull();
  });

  it("case 3b — task with no pod_photos reports no_photos (no throw)", async () => {
    const store = makeFakeStore();
    const result = await capturePodPhotosForTask(
      { tenant_id: TENANT, task_id: TASK_BARE, correlation_id: `corr4-${RUN_ID}` },
      { store, fetch: makeFakeUpstream({}) },
    );
    expect(result.outcome).toBe("no_photos");
  });

  it("case 4 — proxy preference: captured bytes via task:read; Forbidden without; null when uncaptured", async () => {
    const store = makeFakeStore();
    store.objects.set(`${TENANT}/${TASK_HAPPY}/0.jpg`, {
      bytes: bytesOf("JPEGBYTES-A"),
      contentType: "image/jpeg",
    });

    const hit = await getCapturedPodPhoto(
      ctxWith(["task:read"]),
      TASK_HAPPY,
      0,
      { store },
    );
    expect(hit).not.toBeNull();
    expect(hit?.contentType).toBe("image/jpeg");
    expect(new TextDecoder().decode(hit?.bytes ?? new ArrayBuffer(0))).toBe("JPEGBYTES-A");

    await expect(
      getCapturedPodPhoto(ctxWith([]), TASK_HAPPY, 0, { store }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const miss = await getCapturedPodPhoto(
      ctxWith(["task:read"]),
      TASK_BARE,
      0,
      { store },
    );
    expect(miss).toBeNull();
  });

  it("case 5 — guardrail: classification thresholds + the sum sees recorded bytes; never a drop", async () => {
    // Cap = 1 GiB; approaching at 80% (819.2 MiB), critical at 95% (972.8 MiB).
    expect(classifyFreeTierUsage(0)).toBe("ok");
    expect(classifyFreeTierUsage(818 * 1024 * 1024)).toBe("ok");
    expect(classifyFreeTierUsage(820 * 1024 * 1024)).toBe("approaching");
    expect(classifyFreeTierUsage(973 * 1024 * 1024)).toBe("critical");

    const total = await withServiceRole("podcap sum", async (tx) =>
      sumCapturedPodBytes(tx),
    );
    expect(total).toBeGreaterThanOrEqual(22); // case 1 recorded 2 × 11 bytes
  });
});
