---
name: Vitest 4 project config does not inherit resolve.alias from root
description: Same SRC_ALIAS constant declared three times in vitest.config.ts because vitest 4 projects don't inherit resolve.alias. Verify on the next vitest major bump.
type: project
originSessionId: e186efae-548c-4ee9-90fd-92f9249d7b20
---
Vitest 4 project configs do not reliably inherit `resolve.alias` from the top-level config. Surfaced 29 April 2026 in S-2 (PR #28) when the unit project failed to resolve `@/shared/errors` despite a top-level `resolve.alias` for `@`.

Workaround in force: a single `SRC_ALIAS` constant declared once at the top of `vitest.config.ts`, then referenced three times — once at the root, once inside the `unit` project, once inside the `integration` project. Single source of truth via the constant; the duplication is at the *config-tree-shape* level, not the *value* level.

**Why:** vitest 4's project-config inheritance for `resolve.*` is incomplete. The top-level alias works for files under the root project loader but does not propagate into the per-project resolvers used inside `test.projects[]`.

**How to apply:** When upgrading to Vitest 5 or later (or any future version that fixes project-config inheritance), verify by removing the per-project `resolve` blocks and running both `npm run test` and `npm run test:integration`. If both projects still resolve `@/`-prefixed runtime imports correctly, collapse to a single declaration at the root and delete the per-project copies. Refactor cost is one file (`vitest.config.ts`).
