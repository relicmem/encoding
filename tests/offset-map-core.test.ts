import { describe, expect, it } from "vitest";

import type { OffsetMapSegment, OffsetMapSegmentKind } from "../src/index.js";
import { createOffsetMap } from "../src/source/OffsetMap.js";

describe("OffsetMap core", () => {
  it("supports empty documents without manufacturing sentinel segments", () => {
    const map = createOffsetMap([]);

    expect(map.segments()).toEqual([]);
    expect(Object.isFrozen(map.segments())).toBe(true);
    expect(map.byteRangeForTextRange({ start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
    expect(map.textRangeForByteRange({ start: 0, end: 0 })).toEqual({ start: 0, end: 0 });
    expect(map.byteOffsetForTextOffset(0)).toBe(0);
    expect(map.textOffsetForByteOffset(0)).toBe(0);
    expect(() => map.byteOffsetForTextOffset(1)).toThrow(RangeError);
  });

  it("maps identity segments exactly while keeping exposed segments immutable", () => {
    const mutableSegment = {
      byteRange: { start: 0, end: 5 },
      textRange: { start: 0, end: 5 },
      kind: "identity" as const,
    };
    const map = createOffsetMap([mutableSegment]);

    mutableSegment.byteRange.start = 99;
    mutableSegment.textRange.end = 99;

    expect(map.byteOffsetForTextOffset(3)).toBe(3);
    expect(map.textOffsetForByteOffset(4)).toBe(4);
    expect(map.byteRangeForTextRange({ start: 1, end: 4 })).toEqual({ start: 1, end: 4 });
    expect(map.textRangeForByteRange({ start: 2, end: 5 })).toEqual({ start: 2, end: 5 });

    const firstRead = map.segments();
    const secondRead = map.segments();
    const firstSegment = firstRead[0];

    if (firstSegment === undefined) {
      throw new Error("Expected one normalized OffsetMap segment.");
    }

    expect(firstRead).toBe(secondRead);
    expect(Object.isFrozen(firstRead)).toBe(true);
    expect(Object.isFrozen(firstSegment)).toBe(true);
    expect(Object.isFrozen(firstSegment.byteRange)).toBe(true);
    expect(Object.isFrozen(firstSegment.textRange)).toBe(true);
    expect(firstSegment).toEqual(segment("identity", 0, 5, 0, 5));
    expect(() => {
      (firstRead as OffsetMapSegment[]).push(segment("identity", 5, 6, 5, 6));
    }).toThrow(TypeError);
  });

  it("uses bias for non-exact encoded segment interiors", () => {
    const map = createOffsetMap([segment("encoded", 0, 4, 0, 2)]);

    expect(map.byteRangeForTextRange({ start: 0, end: 2 })).toEqual({ start: 0, end: 4 });
    expect(map.textRangeForByteRange({ start: 0, end: 4 })).toEqual({ start: 0, end: 2 });
    expect(map.byteOffsetForTextOffset(1, "start")).toBe(0);
    expect(map.byteOffsetForTextOffset(1, "end")).toBe(4);
    expect(map.byteOffsetForTextOffset(1, "nearest")).toBe(4);
    expect(map.textOffsetForByteOffset(1, "nearest")).toBe(0);
    expect(map.textOffsetForByteOffset(3, "nearest")).toBe(2);
  });

  it("keeps stripped BOM bytes addressable without including them in text ranges by default", () => {
    const map = createOffsetMap([segment("bom", 0, 3, 0, 0), segment("identity", 3, 5, 0, 2)]);

    expect(map.byteOffsetForTextOffset(0, "start")).toBe(0);
    expect(map.byteOffsetForTextOffset(0, "end")).toBe(3);
    expect(map.byteOffsetForTextOffset(0)).toBe(3);
    expect(map.textOffsetForByteOffset(1)).toBe(0);
    expect(map.byteRangeForTextRange({ start: 0, end: 2 })).toEqual({ start: 3, end: 5 });
    expect(map.byteRangeForTextRange({ start: 0, end: 0 })).toEqual({ start: 3, end: 3 });
    expect(map.textRangeForByteRange({ start: 0, end: 3 })).toEqual({ start: 0, end: 0 });
  });

  it("maps replacement and synthetic segments as explicit non-identity spans", () => {
    const map = createOffsetMap([
      segment("identity", 0, 1, 0, 1),
      segment("replacement", 1, 4, 1, 2),
      segment("synthetic", 4, 6, 2, 3),
      segment("identity", 6, 7, 3, 4),
    ]);

    expect(map.byteRangeForTextRange({ start: 1, end: 2 })).toEqual({ start: 1, end: 4 });
    expect(map.textRangeForByteRange({ start: 1, end: 4 })).toEqual({ start: 1, end: 2 });
    expect(map.textOffsetForByteOffset(2, "start")).toBe(1);
    expect(map.textOffsetForByteOffset(3, "end")).toBe(2);
    expect(map.byteRangeForTextRange({ start: 2, end: 3 })).toEqual({ start: 4, end: 6 });
  });

  it("rejects gaps, overlaps and invalid segment shapes", () => {
    expect(() =>
      createOffsetMap([segment("identity", 0, 1, 0, 1), segment("identity", 2, 3, 1, 2)]),
    ).toThrow(RangeError);
    expect(() =>
      createOffsetMap([segment("identity", 0, 1, 0, 1), segment("identity", 1, 2, 0, 1)]),
    ).toThrow(RangeError);
    expect(() => createOffsetMap([segment("identity", 0, 2, 0, 1)])).toThrow(RangeError);
    expect(() => createOffsetMap([segment("bom", 0, 0, 0, 0)])).toThrow(RangeError);
    expect(() => createOffsetMap([segment("unknown" as OffsetMapSegmentKind, 0, 1, 0, 1)])).toThrow(
      RangeError,
    );
  });

  it("rejects lookup ranges and offsets outside the covered bounds", () => {
    const map = createOffsetMap([segment("identity", 0, 2, 0, 2)]);

    expect(() => map.byteRangeForTextRange({ start: 0, end: 3 })).toThrow(RangeError);
    expect(() => map.textRangeForByteRange({ start: 0, end: 3 })).toThrow(RangeError);
    expect(() => map.byteOffsetForTextOffset(3)).toThrow(RangeError);
    expect(() => map.textOffsetForByteOffset(3)).toThrow(RangeError);
  });
});

function segment(
  kind: OffsetMapSegmentKind,
  byteStart: number,
  byteEnd: number,
  textStart: number,
  textEnd: number,
): OffsetMapSegment {
  return {
    byteRange: { start: byteStart, end: byteEnd },
    textRange: { start: textStart, end: textEnd },
    kind,
  };
}
