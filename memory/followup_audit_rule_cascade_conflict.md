---
name: audit_events_no_delete RULE conflicts with ON DELETE CASCADE
description: 0002_audit's append-only RULE blocks cascade-deletes from tenants → audit_events, breaking any future cascade through tenant deletion. Surfaced 27 April 2026 during R-0 verification cleanup.
type: project
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
`supabase/migrations/0002_audit.sql` defines:

```sql
audit_events.tenant_id  uuid REFERENCES tenants(id) ON DELETE CASCADE,
...
CREATE RULE audit_events_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```

These two facts contradict each other. When you `DELETE FROM tenants`, Postgres tries to cascade-delete the matching `audit_events` rows. The `audit_events_no_delete` RULE rewrites that internal DELETE to `DO INSTEAD NOTHING`, which Postgres reports as `ri_PerformCheck: referential integrity query gave unexpected result` — the cascade can't be satisfied, so the original `DELETE FROM tenants` aborts.

Effect: **once any audit_events row exists with a non-null tenant_id, that tenant cannot be deleted.** Even if the test data has zero audit events pointing at it, Postgres still trips the RULE because the rewrite happens at the schema level before row-count is known. Caught in R-0 verification when verify-r0.mjs left test tenants behind that couldn't be cleaned up. Worked around by using random per-run UUIDs/slugs in the script so the harmless artifacts never collide on retry.

**Why:** The append-only audit log was the right design (per R-4) — but pairing `ON DELETE CASCADE` from tenants→audit_events with a blanket `DO INSTEAD NOTHING` rule on audit_events makes the cascade structurally impossible. We probably want one of:

- Drop `ON DELETE CASCADE` and document that audit_events outlive their tenants by design (likely the right answer — audit retention regulations often require this anyway).
- Replace the blanket rule with a more targeted approach: a `BEFORE DELETE` trigger that raises EXCEPTION with a friendlier message, plus a `WITH (security_barrier)` view if read-side filtering is needed. The trigger pattern lets you carve out an "internal cascade" pathway that the rule doesn't intercept.
- Keep CASCADE but DROP the rule and rely solely on the application-layer `withServiceRole`-only insert path to enforce append-only. Loses the database-level defense, which the resolutions doc (R-4) explicitly wanted. Probably not acceptable.

**How to apply:** Out of scope for the R-0 PR — the bug exists on the schema regardless of R-0, just made visible by the verification cleanup path. Tackle in a small T3 PR after Day 2 lands. Suggested approach: drop the FK CASCADE, change to `ON DELETE NO ACTION` or `ON DELETE SET NULL` (both compatible with the rule), and add a comment to 0002 explaining the constraint shape. Need to also clean up the leaked R-0 verification test tenants from the live database — those will require either disabling the rule briefly via a privileged dashboard SQL session, or a one-shot migration that reshapes the FK first.

**Surfaced:** R-0 verification, 27 April 2026. Workaround: verify-r0.mjs uses random per-run UUIDs to avoid retry collisions.

**Scope addition (Day 3, 2026-04-28):** when this fix lands, `consignees` is also in scope. 0004_consignee.sql ships `consignees.tenant_id REFERENCES tenants(id) ON DELETE CASCADE`, same shape as audit_events.tenant_id but without the append-only RULE — so consignees would cascade cleanly today. The point is that whatever FK reshape the audit fix lands on (drop CASCADE, change to NO ACTION, etc.) needs a coherent decision across all tenant-FK tables, not just audit_events. Tenants are the root of every multi-tenant FK chain; the cascade story should be uniform. Re-evaluate every `REFERENCES tenants(id) ON DELETE …` clause in scope when this PR opens: tenants 0001 (users, roles, role_assignments, api_keys), 0002 (audit_events), 0004 (consignees), and any new tables added between now and then.
