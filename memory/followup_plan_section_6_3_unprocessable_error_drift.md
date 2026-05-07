---
name: Plan §6.3 references UnprocessableError class + 422 status that don't exist in shipped error-mapping; drop the 422 row, brief §3.1.8 unaffected
description: Day-16 Block 4-F pre-flight verification surfaced that merged plan PR #155 §6.3 row "UnprocessableError (cut-off violation; computeCompensatingDate exhausted) | 422" references an AppError subclass that does not exist in src/shared/errors.ts and a 422 case absent from src/app/api/_lib/error-response.ts's exhaustive switch. Service A's shipped semantic maps cut-off elapsed → ValidationError → 400 and state mismatches → ConflictError → 409. Resolution: drop the 422 row from §6.3 in the next plan-sync bundle. Brief §3.1.8 "rejected with clear error" is shape-agnostic and unaffected; the change is plan-text alignment with shipped reality.
type: project
---

# Plan §6.3 UnprocessableError + 422 drift

**Surfaced:** Day-16 Block 4-F pre-flight verification.

## §1 The drift

Merged plan PR #155 §6.3 (error-mapping table at line ~657) reads:

| Error | HTTP |
|---|---|
| `ValidationError` (input shape) | 400 |
| `UnauthorizedError` (no session) | 401 |
| `ForbiddenError` (lack permission) | 403 |
| `NotFoundError` (subscription/consignee/tenant id not in tenant) | 404 |
| `ConflictError` (idempotency-key replay; status mismatch) | 409 |
| **`UnprocessableError` (cut-off violation; computeCompensatingDate exhausted) | 422** |
| (any other throw) | 500 |

The 422 row is shipped-reality drift on three counts:

### §1.1 No `UnprocessableError` class in `src/shared/errors.ts`

`src/shared/errors.ts` declares the `AppErrorCode` discriminant union at line 25-32:

```typescript
export type AppErrorCode =
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CREDENTIAL"
  | "NO_TENANT_CONFIGURED"
  | "UNAUTHORIZED";
```

No `"UNPROCESSABLE"` literal; no `UnprocessableError` subclass. The closed `KnownAppError` union at line 130-137 mirrors the same set.

### §1.2 No 422 case in `errorResponse` exhaustive switch

`src/app/api/_lib/error-response.ts:errorResponse` switches on `err.code` discriminant. The exhaustive switch (line 44-76) handles all 7 declared codes; there is no 422 mapping. Adding `UnprocessableError` would require: new class + new union member + new switch case — three coupled edits enforced by the `_exhaustive: never` discipline at line 73-74.

### §1.3 Service A ships `ValidationError` for cut-off + `ConflictError` for state mismatches

Per `src/modules/subscription-exceptions/service.ts:378-381` (commit 9f576f9):

```typescript
if (isCutOffElapsedForDate(now, skipDate)) {
  throw new ValidationError(
    "delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception",
  );
}
```

Cut-off elapsed → `ValidationError` → 400. Subscription-not-active state mismatches at `service.ts:396-400` → `ConflictError` → 409. `computeCompensatingDate`'s 365-day-cap exhaustion (per skip-algorithm.ts) throws a `RangeError`-shaped error not an AppError; falls through to the 500 path of `errorResponse` because it's not a `KnownAppError`.

The shipped semantic uses the existing 400 + 409 mapping; no 422 path exists or is needed.

## §2 Resolution — drop the 422 row from plan §6.3

The minimal fix in the next plan-sync bundle:

**Plan-text amendment (§6.3 line ~657):**

```diff
| `ValidationError` (input shape) | 400 |
| `UnauthorizedError` (no session) | 401 |
| `ForbiddenError` (lack permission) | 403 |
| `NotFoundError` (subscription/consignee/tenant id not in tenant) | 404 |
| `ConflictError` (idempotency-key replay; status mismatch) | 409 |
- | `UnprocessableError` (cut-off violation; computeCompensatingDate exhausted) | 422 |
| (any other throw) | 500 |
```

Plus a one-line note in §6.3's commentary: *"Cut-off violations map to 400 ValidationError per Service A shipped semantic. State mismatches map to 409 ConflictError. Plan does not introduce a 422 status; the 7-code exhaustive switch in `errorResponse` is canonical."*

## §3 Brief §3.1.8 is unaffected

Brief §3.1.8 reads: *"Skips before cut-off apply immediately. Skips after cut-off rejected with clear error in MVP."*

The brief is shape-agnostic on the HTTP status — *"clear error"* is the requirement, not *"422 specifically"*. ValidationError → 400 with the message *"delivery date is past the 18:00 Dubai cut-off the day before; cannot apply exception"* satisfies the brief.

## §4 Block 4-F implication — code follows shipped reality

Block 4-F's 9 net-new route handlers compose against:
- Service A `addSubscriptionException` (skip + append-without-skip routes)
- Service C `changeConsigneeCrmState`
- Service D `createMerchant` / `activateMerchant` / `deactivateMerchant` / `listMerchants`
- Service E `changeAddressRotation` + thunks via `addSubscriptionException` for address-override

ALL of these throw the existing 7 `AppError` subclasses. `errorResponse` maps them to the 7-status set. Block 4-F adds NO new error class, NO new status code, NO new mapping. Plan §6.3 422 row is plan-text-only drift; no code consequence.

## §5 Cross-references

- **`src/shared/errors.ts:25-32`** — `AppErrorCode` closed union; no UNPROCESSABLE literal
- **`src/shared/errors.ts:130-137`** — `KnownAppError` closed union; no UnprocessableError subclass
- **`src/app/api/_lib/error-response.ts:44-76`** — exhaustive switch; no 422 case
- **`src/modules/subscription-exceptions/service.ts:378-381`** — cut-off → ValidationError → 400 (Service A shipped semantic)
- **`memory/plans/day-14-part2-service-layer.md`** §6.3 — the drift source
- **`memory/PLANNER_PRODUCT_BRIEF.md`** v1.3 §3.1.8 — shape-agnostic "rejected with clear error" requirement; unaffected
- **Reviewer Block 4-F §C ruling** (Day-16 turn closing pre-flight verification) — followup memo path locked; plan-text amendment for next plan-sync bundle
