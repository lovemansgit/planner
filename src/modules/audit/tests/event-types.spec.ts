// Audit event-type vocabulary invariants — R-4 / Day 2.

import { describe, expect, it } from "vitest";

import {
  ALL_EVENT_TYPE_IDS,
  EVENT_TYPES,
  isKnownEventType,
  type EventTypeId,
} from "../event-types";

describe("event_types vocabulary", () => {
  it("freezes at module-import time", () => {
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true);
  });

  it("defines every entry's id to match its map key", () => {
    for (const id of ALL_EVENT_TYPE_IDS) {
      expect(EVENT_TYPES[id].id).toBe(id);
    }
  });

  it("derives every id from `${resource}.${action}` consistently", () => {
    for (const id of ALL_EVENT_TYPE_IDS) {
      const def = EVENT_TYPES[id];
      expect(`${def.resource}.${def.action}`).toBe(id);
    }
  });

  it("requires a non-empty description on every entry", () => {
    for (const id of ALL_EVENT_TYPE_IDS) {
      expect(EVENT_TYPES[id].description.trim().length).toBeGreaterThan(0);
    }
  });

  it("recognizes its own ids via isKnownEventType and rejects unknowns", () => {
    for (const id of ALL_EVENT_TYPE_IDS) {
      expect(isKnownEventType(id)).toBe(true);
    }
    expect(isKnownEventType("definitely.not_a_real_event")).toBe(false);
    expect(isKnownEventType("")).toBe(false);
  });

  it("uses `.` separator (audit events) — not `:` (which is for permission ids)", () => {
    // Defends the perm-vs-event separator distinction documented at the
    // top of event-types.ts and permissions.ts. A drift from this would
    // collapse the at-a-glance distinction between perm checks and
    // audit events.
    for (const id of ALL_EVENT_TYPE_IDS) {
      expect(id).not.toContain(":");
      expect(id).toContain(".");
    }
  });
});

describe("bulk-import events (Day-2 brief §7)", () => {
  // The five entries the morning brief explicitly required.
  const bulkImportIds: readonly EventTypeId[] = [
    "consignee.bulk_created",
    "subscription.bulk_created",
    "tenant.migration_imported",
    "tenant.migration_gate_changed",
    "import.validation_failed",
  ];

  it("includes all five entries in the catalogue", () => {
    for (const id of bulkImportIds) {
      expect(EVENT_TYPES[id]).toBeDefined();
    }
  });

  it("flags the migration entries as systemOnly", () => {
    expect(EVENT_TYPES["tenant.migration_imported"].systemOnly).toBe(true);
    expect(EVENT_TYPES["tenant.migration_gate_changed"].systemOnly).toBe(true);
  });

  it("documents required metadata fields for bulk-create events (import_id, row_count, file_hash)", () => {
    // The brief mandates these fields. Catalogue documentation is the
    // contract — call sites that emit these events without including
    // these fields are reviewable against this same metadataNotes
    // string. The notes field is freeform documentation, not a runtime
    // schema check, so we assert the documented expectation rather
    // than runtime enforcement.
    for (const id of [
      "consignee.bulk_created",
      "subscription.bulk_created",
      "tenant.migration_imported",
    ] as const) {
      const notes = EVENT_TYPES[id].metadataNotes;
      expect(notes).toContain("import_id");
      expect(notes).toContain("row_count");
      expect(notes).toContain("file_hash");
    }
  });

  it("documents the validation_failed event's diagnostic metadata fields", () => {
    const notes = EVENT_TYPES["import.validation_failed"].metadataNotes;
    expect(notes).toContain("import_id");
    expect(notes).toContain("file_hash");
    expect(notes).toContain("failure_count");
  });
});

describe("db.service_role.use event (R-3 + R-4 contract)", () => {
  it("is in the catalogue", () => {
    expect(EVENT_TYPES["db.service_role.use"]).toBeDefined();
  });

  it("is systemOnly (only emitted by the audit observer, never by a tenant actor)", () => {
    expect(EVENT_TYPES["db.service_role.use"].systemOnly).toBe(true);
  });

  it("documents `reason` as the metadata field", () => {
    expect(EVENT_TYPES["db.service_role.use"].metadataNotes).toContain("reason");
  });
});
