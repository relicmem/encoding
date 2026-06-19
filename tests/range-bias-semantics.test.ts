import { describe, expect, it } from "vitest";

import {
  assertOffsetBias,
  isCollapsedRange,
  normalizeOffsetBias,
  normalizeSourceByteRange,
  normalizeTextRange,
  rangeLength,
  resolveOffsetByBias,
  validateSourceByteRange,
  validateTextRange,
} from "../src/source/ranges.js";

describe("range and bias semantics", () => {
  it("normalizes undefined ranges to full half-open bounds", () => {
    const byteRange = normalizeSourceByteRange(undefined, 4);
    const textRange = normalizeTextRange(undefined, 6);

    expect(byteRange).toEqual({ start: 0, end: 4 });
    expect(textRange).toEqual({ start: 0, end: 6 });
    expect(Object.isFrozen(byteRange)).toBe(true);
    expect(Object.isFrozen(textRange)).toBe(true);
  });

  it("accepts collapsed and end-at-bound half-open ranges", () => {
    const byteRange = validateSourceByteRange({ start: 4, end: 4 }, 4);
    const textRange = validateTextRange({ start: 1, end: 3 }, 3);

    expect(byteRange).toEqual({ start: 4, end: 4 });
    expect(textRange).toEqual({ start: 1, end: 3 });
    expect(isCollapsedRange(byteRange)).toBe(true);
    expect(rangeLength(textRange)).toBe(2);
  });

  it("rejects invalid byte and text ranges without silent coercion", () => {
    expect(() => validateSourceByteRange({ start: -1, end: 1 })).toThrow(RangeError);
    expect(() => validateSourceByteRange({ start: 0.5, end: 1 })).toThrow(RangeError);
    expect(() => validateSourceByteRange({ start: 2, end: 1 })).toThrow(RangeError);
    expect(() => validateSourceByteRange({ start: 0, end: 5 }, 4)).toThrow(RangeError);

    expect(() => validateTextRange({ start: -1, end: 1 })).toThrow(RangeError);
    expect(() => validateTextRange({ start: 0, end: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      RangeError,
    );
    expect(() => normalizeTextRange(undefined, -1)).toThrow(RangeError);
  });

  it("normalizes and validates OffsetBias values", () => {
    expect(normalizeOffsetBias(undefined)).toBe("nearest");
    expect(normalizeOffsetBias("start")).toBe("start");
    expect(normalizeOffsetBias("end")).toBe("end");
    expect(normalizeOffsetBias("nearest")).toBe("nearest");
    expect(() => {
      assertOffsetBias("middle");
    }).toThrow(RangeError);
  });

  it("resolves boundary offsets exactly regardless of bias", () => {
    const fromRange = { start: 10, end: 14 };
    const toRange = { start: 2, end: 6 };

    expect(resolveOffsetByBias({ offset: 10, fromRange, toRange, bias: "end" })).toBe(2);
    expect(resolveOffsetByBias({ offset: 14, fromRange, toRange, bias: "start" })).toBe(6);
  });

  it("uses bias for interior offsets in non-exact segment projections", () => {
    const fromRange = { start: 10, end: 14 };
    const toRange = { start: 2, end: 6 };

    expect(resolveOffsetByBias({ offset: 11, fromRange, toRange, bias: "start" })).toBe(2);
    expect(resolveOffsetByBias({ offset: 11, fromRange, toRange, bias: "end" })).toBe(6);
    expect(resolveOffsetByBias({ offset: 11, fromRange, toRange, bias: "nearest" })).toBe(2);
    expect(resolveOffsetByBias({ offset: 13, fromRange, toRange, bias: "nearest" })).toBe(6);
    expect(resolveOffsetByBias({ offset: 12, fromRange, toRange, bias: "nearest" })).toBe(6);
  });

  it("defines collapsed text range behavior for stripped BOM segments", () => {
    const collapsedBomTextRange = { start: 0, end: 0 };
    const bomByteRange = { start: 0, end: 3 };

    expect(
      resolveOffsetByBias({
        offset: 0,
        fromRange: collapsedBomTextRange,
        toRange: bomByteRange,
        bias: "start",
      }),
    ).toBe(0);
    expect(
      resolveOffsetByBias({
        offset: 0,
        fromRange: collapsedBomTextRange,
        toRange: bomByteRange,
        bias: "end",
      }),
    ).toBe(3);
    expect(
      resolveOffsetByBias({
        offset: 0,
        fromRange: collapsedBomTextRange,
        toRange: bomByteRange,
      }),
    ).toBe(3);
  });

  it("maps offsets in source-only collapsed output to the single target boundary", () => {
    const bomByteRange = { start: 0, end: 3 };
    const collapsedBomTextRange = { start: 0, end: 0 };

    expect(
      resolveOffsetByBias({
        offset: 1,
        fromRange: bomByteRange,
        toRange: collapsedBomTextRange,
        bias: "start",
      }),
    ).toBe(0);
    expect(
      resolveOffsetByBias({
        offset: 2,
        fromRange: bomByteRange,
        toRange: collapsedBomTextRange,
        bias: "end",
      }),
    ).toBe(0);
  });

  it("rejects out-of-bounds offsets for segment projection", () => {
    const fromRange = { start: 10, end: 14 };
    const toRange = { start: 2, end: 6 };

    expect(() => resolveOffsetByBias({ offset: 9, fromRange, toRange })).toThrow(RangeError);
    expect(() => resolveOffsetByBias({ offset: 15, fromRange, toRange })).toThrow(RangeError);
  });
});
