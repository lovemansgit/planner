# Decision — Brief v1.36 amendment: "Emirate" → "City" UI relabel (cross-market terminology)

**Date:** 25 Jun 2026 (Day 60, Phase 12.2 RELABEL lane)
**Scope class:** docs-only — NO src, NO migration, NO promote.
**Companion code PR:** #648 (the app-wide display relabel). This amendment is filed as a
**separate held docs PR** that merges **immediately after** #648 — the brief must not say
"City" while the shipped UI still says "Emirate."
**Sibling data PR:** #647 (admin /tasks District + City columns + addresses-join data wiring).

## Ruling (Love, verbatim — the rationale of record)

> "City" is the app-wide label. emirate (in the UAE) = city; the product also runs in KSA,
> Qatar, etc., where the value is a city — so "City" is the correct cross-market label.

This resolves LOVE-TRIGGER #2 (brief drift) that the independent reviewer raised on #648:
the brief named this field "Emirate" as user-facing terminology, and an app-wide noun change
needed Love's product-terminology ruling on record + a §9 amendment. The ruling is now on
record; this memo + the §9 row are the amendment.

## What changes (display labels only)

The **user-facing label** "Emirate" becomes **"City"** on every operator + admin surface:
operator /tasks column header; consignees list column header; consignee-create form field +
validation copy ("Emirate is required." → "City is required."); add-address dialog field;
merchant create/edit forms + detail pickup-address label + validation copy; and the two
consignee-detail "Emirate / region" labels (operator + admin) for consistency.

## What does NOT change (the display-only contract)

- **DB columns** — `consignees.emirate_or_region`, `tenants.pickup_address_emirate`,
  `addresses.emirate` are UNCHANGED. No migration.
- **Internal identifiers** — `effectiveEmirate`, `addressEmirate`, `pickupEmirate`, the
  consignee-cell `emirate` model key, and the **form field NAMEs** (`address_emirate`,
  `pickup_emirate`, `emirate`) are UNCHANGED, so no wire/parse break.
- **Brief §3.1.1 data-column reference** (the `addresses.emirate` text column line) stays
  "emirate" — it names the schema column, not a UI label. It already carries the forward
  note "(or city/country for non-UAE Phase 2)," which this ruling makes present-tense for
  the label layer.

## Brief body edits in this amendment (form-field LABEL references → "City")

- §3.3.1 consignee-create "Address section" field list: "Emirate" → "City".
- §2.1 merchant create-form field list: "(street, district, emirate)" → "(street, district, city)".
- §2.1 merchant edit-form field list: "(line/district/emirate)" → "(line/district/city)".

These three describe user-facing form fields; the schema-column reference in §3.1.1 is left
intact per the contract above.

## Process

Append-only §9 row (v1.36); version markers bumped (`**Version:**` line + closing
`**End of …**`); table rows above untouched. Additive-only diff. Re-confirm / renumber at
merge-prep if a peer bump lands first (recorded fixup rule).
