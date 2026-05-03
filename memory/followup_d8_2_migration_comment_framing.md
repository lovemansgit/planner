---
name: D8-2 migration comment framing — credential model is Tier-2 context, not default
description: Migration 0013_sf_integration_required_fields.sql lines 102-104 frame credential verification as the default webhook auth path. P2's reshape on 3 May 2026 made credentials Tier-2-only (graceful degradation when configured); the default is now tenant-existence + payload-shape (Tier 1 / Option I). Migration comment is a forensic artifact of commit-time intent, not a living doc — amend in a Day-10 docs-pass batch alongside any other comment-drift findings.
type: project
---

# D8-2 migration comment framing — Tier-2-only context, not default path

**Surfaced:** 3 May 2026 (Day 9 D8-8 schema sanity grep)
**Source:** Reading `supabase/migrations/0013_sf_integration_required_fields.sql` for D8-2 schema verification before D8-8 implementation.

---

## The drift

`0013_sf_integration_required_fields.sql` lines 102-104:

> *Receiver hardening (D8-8) reads this table to look up the tenant's credential pair on every webhook POST, then constant-time-compares against the request headers. 401 on mismatch + emit `webhook.auth_failed`.*

This framing was correct as of D8-2's commit-time intent (mid-Day-8, when Day-7's design memo was the latest source of truth). It described the credential check as the **default verification path** for every inbound webhook.

**P2's reshape on 3 May 2026** (per `memory/followup_d8_8_webhook_auth_model.md`) demoted credentials from default to **Tier-2 / opt-in per merchant**. Production merchants typically don't configure Client ID/Secret, so the receiver's Option I + IV layered model gates on tenant-existence + payload-shape (Tier 1) by default and only invokes credential check when a credentials row exists for the tenant (Tier 2).

The migration comment is now subtly misleading — it implies "every webhook POST" goes through credential comparison, but in practice production runs Tier 1 only.

---

## Why this matters (Day-10 priority, low urgency)

- **Migration files are forward-only** (per project convention, line 13 of the migration). The data definitions don't change; this is a comment-drift issue.
- **Future-Claude reading the migration as "current state of truth" gets the wrong mental model.** The schema is the schema; the workflow around it has shifted.
- **Cross-pollution risk:** if D8-8's PR description copies the migration comment as documentation, the Tier-1-default reshape gets buried.

---

## How to apply

Day-10 docs-pass batch:
1. Amend the migration comment to: *"Receiver hardening (D8-8) reads this table when a credentials row exists for the tenant (Tier 2). When the row is absent, falls back to tenant-existence + payload-shape verification only (Tier 1, default for production merchants who don't configure SF webhook credentials)."*
2. Search for other comment-drift cases in `supabase/migrations/*.sql` and `src/**/*.ts` — particularly any reference to "every webhook POST" / "all incoming webhooks" / "credential-based verification" that may have shifted with the P2 reshape.
3. Land all amendments in one T1 commit so reviewer sees the comment-drift category as a unit, not piecemeal.

**NOT D8-8's job.** D8-8's PR description carries the correct Tier-1-default framing in its own narrative; D8-8 doesn't touch migration comments because the schema is forward-only and the comment isn't load-bearing for the code change.

---

## Cross-references

- `memory/followup_d8_8_webhook_auth_model.md` — the P2 reshape that demoted credentials from default to Tier-2-only
- `memory/followup_webhook_auth_architecture.md` — Day-7 EOD design memo where the credential-default framing originated; Tier-2-default IS still correct for the empirical capture (Tabchilli configured creds on the sandbox), the over-generalisation was the issue
- `supabase/migrations/0013_sf_integration_required_fields.sql` — the migration with the comment-drift target
