// read.ts unit tests — Day-52 / R8 (the audit module's first read path).
//
// The functions take the caller's tx, so a stub with a recording
// execute() is enough — no db mocking. Assertions cover the row→record
// mapping and the load-bearing pieces of the generated SQL (exclusion,
// keyset cursor, ordering, limit) by flattening the drizzle SQL object
// to text. RLS behavior (tenant scoping) is a property of the
// withTenant transaction the CALLER supplies and is documented at the
// function level — not unit-testable here.

import { describe, expect, it, vi } from "vitest";
import { SQL } from "drizzle-orm";

import {
  listAuditEventsForResource,
  listAuditEventsForSubscription,
} from "../read";

// Flatten a drizzle SQL object into readable text: string chunks join
// as-is, bound params render as <param:json>.
function sqlToText(fragment: unknown): string {
  if (fragment instanceof SQL) {
    return fragment.queryChunks.map(sqlToText).join("");
  }
  if (Array.isArray(fragment)) {
    return fragment.join("");
  }
  if (
    typeof fragment === "object" &&
    fragment !== null &&
    "value" in fragment
  ) {
    const value = (fragment as { value: unknown }).value;
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value.join("");
    }
    return `<param:${JSON.stringify(value)}>`;
  }
  return String(fragment);
}

const ROW = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  occurred_at: "2026-06-10T09:00:00.000000Z",
  actor_kind: "user" as const,
  actor_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  event_type: "task.updated",
  resource_type: "task",
  resource_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  metadata: { changed_fields: ["notes"] },
};

function stubTx(rows: unknown[] = [ROW]) {
  const execute = vi.fn().mockResolvedValue(rows);
  return { tx: { execute } as never, execute };
}

describe("listAuditEventsForResource", () => {
  it("maps rows to camelCase records", async () => {
    const { tx } = stubTx();
    const records = await listAuditEventsForResource(tx, {
      resourceType: "task",
      resourceId: ROW.resource_id,
      limit: 16,
    });
    expect(records).toEqual([
      {
        id: ROW.id,
        occurredAt: ROW.occurred_at,
        actorKind: "user",
        actorId: ROW.actor_id,
        eventType: "task.updated",
        resourceType: "task",
        resourceId: ROW.resource_id,
        metadata: { changed_fields: ["notes"] },
      },
    ]);
  });

  it("orders newest-first on (occurred_at, id) and applies the limit", async () => {
    const { tx, execute } = stubTx([]);
    await listAuditEventsForResource(tx, {
      resourceType: "task",
      resourceId: ROW.resource_id,
      limit: 16,
    });
    const text = sqlToText(execute.mock.calls[0][0]);
    expect(text).toContain("ORDER BY occurred_at DESC, id DESC");
    expect(text).toContain("LIMIT 16");
    expect(text).not.toContain("<> ALL");
  });

  it("excludes event types in SQL so the limit cannot be starved by excluded rows", async () => {
    const { tx, execute } = stubTx([]);
    await listAuditEventsForResource(tx, {
      resourceType: "task",
      resourceId: ROW.resource_id,
      excludeEventTypes: ["task.push_failed", "failed_push.retried"],
      limit: 16,
    });
    const text = sqlToText(execute.mock.calls[0][0]);
    expect(text).toContain("event_type <> ALL");
    expect(text).toContain("{task.push_failed,failed_push.retried}");
  });

  it("applies the keyset cursor as a strict (occurred_at, id) tuple comparison", async () => {
    const { tx, execute } = stubTx([]);
    await listAuditEventsForResource(tx, {
      resourceType: "task",
      resourceId: ROW.resource_id,
      before: { occurredAt: ROW.occurred_at, id: ROW.id },
      limit: 16,
    });
    const text = sqlToText(execute.mock.calls[0][0]);
    expect(text).toContain("(occurred_at, id) <");
    expect(text).toContain(ROW.occurred_at);
    expect(text).toContain(ROW.id);
  });
});

describe("listAuditEventsForSubscription", () => {
  it("filters on metadata subscription_id, newest-first, with the guard-rail limit", async () => {
    const { tx, execute } = stubTx([ROW]);
    const records = await listAuditEventsForSubscription(tx, {
      subscriptionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      limit: 500,
    });
    const text = sqlToText(execute.mock.calls[0][0]);
    expect(text).toContain("metadata->>'subscription_id' =");
    expect(text).toContain("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(text).toContain("ORDER BY occurred_at DESC, id DESC");
    expect(text).toContain("LIMIT 500");
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe("task.updated");
  });
});
