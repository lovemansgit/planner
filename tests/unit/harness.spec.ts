// tests/unit/harness.spec.ts
//
// Vitest harness smoke test per plan §11.2 #9 ("A hello-world test in
// each"). Proves the unit project is wired up and `npm run test` succeeds
// before any real test code lands. Real unit tests start arriving Day 2
// with the identity module's permission catalogue and requirePermission
// helper.
//
// Without at least one passing test in the unit project, `vitest run
// --project unit` exits non-zero and the CI workflow fails on its first
// run.

import { describe, it, expect } from "vitest";

describe("vitest unit harness", () => {
  it("can run a unit test", () => {
    expect(1 + 1).toBe(2);
  });
});
