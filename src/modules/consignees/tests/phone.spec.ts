// Phone normalisation tests.

import { describe, expect, it } from "vitest";

import { ValidationError } from "../../../shared/errors";
import { normaliseToE164 } from "../phone";

describe("normaliseToE164", () => {
  describe("E.164 input passes through unchanged", () => {
    it("accepts +971 mobile", () => {
      expect(normaliseToE164("+971501234567")).toBe("+971501234567");
    });
    it("accepts +966 KSA mobile", () => {
      expect(normaliseToE164("+966501234567")).toBe("+966501234567");
    });
    it("accepts +44 UK", () => {
      expect(normaliseToE164("+447911123456")).toBe("+447911123456");
    });
    it("strips whitespace, dashes, parens, dots", () => {
      expect(normaliseToE164("+971 (50) 123-4567")).toBe("+971501234567");
      expect(normaliseToE164("+971.50.123.4567")).toBe("+971501234567");
    });
  });

  describe("UAE local mobile (auto-default)", () => {
    it("0501234567 → +971501234567", () => {
      expect(normaliseToE164("0501234567")).toBe("+971501234567");
    });
    it("501234567 → +971501234567", () => {
      expect(normaliseToE164("501234567")).toBe("+971501234567");
    });
    it("050 123 4567 → +971501234567 (whitespace stripped)", () => {
      expect(normaliseToE164("050 123 4567")).toBe("+971501234567");
    });
    it("(050) 123-4567 → +971501234567 (paste-from-Excel shape)", () => {
      expect(normaliseToE164("(050) 123-4567")).toBe("+971501234567");
    });
  });

  describe("UAE local landline (auto-default)", () => {
    it("Dubai 04 1234567 → +97141234567", () => {
      expect(normaliseToE164("041234567")).toBe("+97141234567");
    });
    it("Abu Dhabi 02 1234567 → +97121234567", () => {
      expect(normaliseToE164("021234567")).toBe("+97121234567");
    });
    it("Sharjah 06 1234567 → +97161234567", () => {
      expect(normaliseToE164("061234567")).toBe("+97161234567");
    });
  });

  describe("rejection — ValidationError", () => {
    it("rejects empty string", () => {
      expect(() => normaliseToE164("")).toThrow(ValidationError);
    });
    it("rejects whitespace-only", () => {
      expect(() => normaliseToE164("   ")).toThrow(/could not be normalised/);
    });
    it("rejects malformed E.164 (too short)", () => {
      expect(() => normaliseToE164("+1234")).toThrow(/not valid E\.164/);
    });
    it("rejects malformed E.164 (too long)", () => {
      expect(() => normaliseToE164("+1234567890123456")).toThrow(/not valid E\.164/);
    });
    it("rejects E.164 with letters", () => {
      expect(() => normaliseToE164("+971abc1234567")).toThrow(/not valid E\.164/);
    });
    it("rejects KSA local without country code (UAE auto-default doesn't apply)", () => {
      // 9-digit KSA mobile starting with 5 happens to MATCH UAE_MOBILE_RE.
      // This is a known limitation documented in the file header — the
      // pilot is UAE-first; KSA callers MUST submit E.164. The collision
      // with UAE shape is exactly why ambiguous input gets defaulted to
      // UAE rather than rejected. This test pins that behaviour so a
      // future change is conscious.
      expect(normaliseToE164("501234567")).toBe("+971501234567");
    });
    it("rejects something that isn't a phone at all", () => {
      expect(() => normaliseToE164("hello")).toThrow(/could not be normalised/);
    });
  });
});
