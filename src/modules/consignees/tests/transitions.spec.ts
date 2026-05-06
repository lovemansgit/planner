// Pure unit tests for the CRM transition matrix.
//
// No mocks, no DB, no async. The matrix and canTransition are pure;
// the only inputs are the (from, to, reason) triple. This file
// exhaustively covers:
//
//   - Every (from, to) cell in the 6x6 matrix (35 non-same-state pairs;
//     same-state isn't tested here because the service layer
//     short-circuits before this helper sees it).
//   - The CHURNED → ACTIVE keyword guard (case-insensitive substring on
//     `reactivation`).
//   - Edge cases on the reason string (empty, whitespace-only, mixed
//     case, embedded in longer text).
//
// Matrix correctness is the load-bearing assertion: a future plan-text
// or brief change to the matrix must update both the source and these
// tests; the spec's row count is its own regression signal.

import { describe, expect, it } from "vitest";

import { ALLOWED_TRANSITIONS, canTransition } from "../transitions";
import type { ConsigneeCrmState } from "../types";

const ALL_STATES: readonly ConsigneeCrmState[] = [
  "ACTIVE",
  "ON_HOLD",
  "HIGH_RISK",
  "INACTIVE",
  "CHURNED",
  "SUBSCRIPTION_ENDED",
];

describe("ALLOWED_TRANSITIONS matrix shape", () => {
  it("indexes by every CRM state", () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[state]).toBeInstanceOf(Set);
    }
  });

  it("has SUBSCRIPTION_ENDED as a terminal state with no allowed transitions", () => {
    expect(ALLOWED_TRANSITIONS.SUBSCRIPTION_ENDED.size).toBe(0);
  });

  it("never includes same-state in any from-state's allowed set", () => {
    for (const state of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[state].has(state)).toBe(false);
    }
  });

  it("admits INACTIVE and SUBSCRIPTION_ENDED from every non-terminal state", () => {
    const nonTerminal: readonly ConsigneeCrmState[] = [
      "ACTIVE",
      "ON_HOLD",
      "HIGH_RISK",
      "INACTIVE",
      "CHURNED",
    ];
    for (const from of nonTerminal) {
      if (from !== "INACTIVE") {
        expect(ALLOWED_TRANSITIONS[from].has("INACTIVE")).toBe(true);
      }
      expect(ALLOWED_TRANSITIONS[from].has("SUBSCRIPTION_ENDED")).toBe(true);
    }
  });
});

describe("ALLOWED_TRANSITIONS — exhaustive cell-by-cell §10.4 lock", () => {
  // Each row is (from, expected-allowed-to-set). Mirrors the §10.4
  // matrix verbatim. A spec-source update to the matrix WITHOUT a
  // matching update here trips a test failure with a precise diagnosis
  // (which `to` slipped in or out).
  const expected: ReadonlyArray<{ from: ConsigneeCrmState; allowed: readonly ConsigneeCrmState[] }> = [
    { from: "ACTIVE", allowed: ["ON_HOLD", "HIGH_RISK", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"] },
    { from: "ON_HOLD", allowed: ["ACTIVE", "HIGH_RISK", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"] },
    { from: "HIGH_RISK", allowed: ["ACTIVE", "ON_HOLD", "CHURNED", "INACTIVE", "SUBSCRIPTION_ENDED"] },
    { from: "INACTIVE", allowed: ["ACTIVE", "SUBSCRIPTION_ENDED"] },
    { from: "CHURNED", allowed: ["ACTIVE", "INACTIVE", "SUBSCRIPTION_ENDED"] },
    { from: "SUBSCRIPTION_ENDED", allowed: [] },
  ];

  for (const { from, allowed } of expected) {
    it(`from ${from}: allowed set is exactly ${JSON.stringify(allowed)}`, () => {
      const actual = Array.from(ALLOWED_TRANSITIONS[from]).sort();
      expect(actual).toEqual([...allowed].sort());
    });
  }
});

describe("canTransition — every disallowed pair returns invalid_transition", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (from === to) continue;
      if (ALLOWED_TRANSITIONS[from].has(to)) continue;
      it(`${from} → ${to} → invalid_transition`, () => {
        const result = canTransition(from, to, "any reason");
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errorCode).toBe("invalid_transition");
        }
      });
    }
  }
});

describe("canTransition — every allowed non-CHURNED-to-ACTIVE pair returns ok", () => {
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      if (from === to) continue;
      if (!ALLOWED_TRANSITIONS[from].has(to)) continue;
      // CHURNED → ACTIVE has the keyword guard; covered below.
      if (from === "CHURNED" && to === "ACTIVE") continue;
      it(`${from} → ${to} returns ok with any non-empty reason`, () => {
        const result = canTransition(from, to, "operator note");
        expect(result.ok).toBe(true);
      });
    }
  }
});

describe("canTransition — CHURNED → ACTIVE keyword guard", () => {
  it("rejects with reactivation_keyword_required when reason has no 'reactivation' substring", () => {
    const result = canTransition("CHURNED", "ACTIVE", "won them back");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("reactivation_keyword_required");
    }
  });

  it("accepts when reason contains 'reactivation' (lowercase)", () => {
    const result = canTransition("CHURNED", "ACTIVE", "reactivation after escalation");
    expect(result.ok).toBe(true);
  });

  it("accepts when reason contains 'Reactivation' (mixed case — substring is case-insensitive)", () => {
    const result = canTransition("CHURNED", "ACTIVE", "Reactivation by ops");
    expect(result.ok).toBe(true);
  });

  it("accepts when reason contains 'REACTIVATION' (uppercase)", () => {
    const result = canTransition("CHURNED", "ACTIVE", "REACTIVATION");
    expect(result.ok).toBe(true);
  });

  it("accepts when 'reactivation' is embedded in longer text", () => {
    const result = canTransition(
      "CHURNED",
      "ACTIVE",
      "Customer reached out; manual reactivation approved by tenant admin",
    );
    expect(result.ok).toBe(true);
  });

  it("rejects empty-string reason", () => {
    const result = canTransition("CHURNED", "ACTIVE", "");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("reactivation_keyword_required");
    }
  });

  it("rejects whitespace-only reason (the keyword regex still fails)", () => {
    const result = canTransition("CHURNED", "ACTIVE", "    \t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("reactivation_keyword_required");
    }
  });

  it("rejects partial-keyword 'reactiv' (substring requires the full word)", () => {
    const result = canTransition("CHURNED", "ACTIVE", "reactiv plan in flight");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe("reactivation_keyword_required");
    }
  });
});

describe("canTransition — CHURNED → other-than-ACTIVE allowed without keyword", () => {
  // The keyword guard is specific to CHURNED → ACTIVE; CHURNED →
  // INACTIVE / SUBSCRIPTION_ENDED are routine offboard paths and need
  // permission only.
  it("CHURNED → INACTIVE returns ok with any reason", () => {
    expect(canTransition("CHURNED", "INACTIVE", "cleanup").ok).toBe(true);
  });

  it("CHURNED → SUBSCRIPTION_ENDED returns ok with any reason", () => {
    expect(canTransition("CHURNED", "SUBSCRIPTION_ENDED", "subscription expired").ok).toBe(true);
  });
});
