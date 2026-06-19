import { describe, expect, it } from "vitest";

import { createLineIndex } from "../src/source/LineIndex.js";
import { buildIdentityOffsetMap, buildUtf8OffsetMap } from "../src/source/OffsetMapBuilder.js";
import type { OffsetMapBuildResult } from "../src/source/OffsetMapBuilder.js";

describe("LineIndex", () => {
  it("indexes empty text as one empty line", () => {
    const offsetMap = buildIdentityOffsetMap(0).offsetMap;
    const lineIndex = createLineIndex("", offsetMap);

    expect(lineIndex.lineCount).toBe(1);
    expect(lineIndex.lineStartOffset(1)).toBe(0);
    expect(lineIndex.lineEndOffset(1)).toBe(0);
    expect(lineIndex.lineTextRange(1)).toEqual({ start: 0, end: 0 });
    expect(lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 0 });
    expect(lineIndex.lineByteRange(1)).toEqual({ start: 0, end: 0 });
    expect(lineIndex.positionAtTextOffset(0)).toEqual({
      byteOffset: 0,
      characterOffset: 0,
      line: 1,
      column: 1,
    });
  });

  it("counts LF, CRLF and CR without normalizing line endings", () => {
    const text = "a\r\nb\rc\nd";
    const lineIndex = createLineIndex(text, buildIdentityOffsetMap(text.length).offsetMap);

    expect(lineIndex.lineCount).toBe(4);
    expect(lineIndex.lineTextRange(1)).toEqual({ start: 0, end: 1 });
    expect(lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(lineIndex.lineTextRange(2)).toEqual({ start: 3, end: 4 });
    expect(lineIndex.lineTextRange(2, true)).toEqual({ start: 3, end: 5 });
    expect(lineIndex.lineTextRange(3)).toEqual({ start: 5, end: 6 });
    expect(lineIndex.lineTextRange(3, true)).toEqual({ start: 5, end: 7 });
    expect(lineIndex.lineTextRange(4)).toEqual({ start: 7, end: 8 });
    expect(lineIndex.lineTextRange(4, true)).toEqual({ start: 7, end: 8 });

    expect(lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(lineIndex.lineByteRange(2, true)).toEqual({ start: 3, end: 5 });
    expect(lineIndex.lineByteRange(3, true)).toEqual({ start: 5, end: 7 });
  });

  it("uses one-based line and column positions at text offsets", () => {
    const text = "a\r\nb\rc\nd";
    const lineIndex = createLineIndex(text, buildIdentityOffsetMap(text.length).offsetMap);

    expect(lineIndex.positionAtTextOffset(0)).toMatchObject({ line: 1, column: 1 });
    expect(lineIndex.positionAtTextOffset(1)).toMatchObject({ line: 1, column: 2 });
    expect(lineIndex.positionAtTextOffset(2)).toMatchObject({ line: 1, column: 2 });
    expect(lineIndex.positionAtTextOffset(3)).toMatchObject({ line: 2, column: 1 });
    expect(lineIndex.positionAtTextOffset(5)).toMatchObject({ line: 3, column: 1 });
    expect(lineIndex.positionAtTextOffset(8)).toMatchObject({ line: 4, column: 2 });
  });

  it("keeps trailing newline as an empty final line", () => {
    const text = "a\n";
    const lineIndex = createLineIndex(text, buildIdentityOffsetMap(text.length).offsetMap);

    expect(lineIndex.lineCount).toBe(2);
    expect(lineIndex.lineTextRange(1)).toEqual({ start: 0, end: 1 });
    expect(lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 2 });
    expect(lineIndex.lineTextRange(2)).toEqual({ start: 2, end: 2 });
    expect(lineIndex.lineByteRange(2)).toEqual({ start: 2, end: 2 });
    expect(lineIndex.positionAtTextOffset(2)).toEqual({
      byteOffset: 2,
      characterOffset: 2,
      line: 2,
      column: 1,
    });
  });

  it("uses OffsetMap for original byte ranges and byte positions", () => {
    const text = "AЖ\n😀";
    const offsetMap = unwrapBuildResult(
      buildUtf8OffsetMap(new Uint8Array([0x41, 0xd0, 0x96, 0x0a, 0xf0, 0x9f, 0x98, 0x80])),
    ).offsetMap;
    const lineIndex = createLineIndex(text, offsetMap);

    expect(lineIndex.lineCount).toBe(2);
    expect(lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 4 });
    expect(lineIndex.lineTextRange(2)).toEqual({ start: 3, end: 5 });
    expect(lineIndex.lineByteRange(2)).toEqual({ start: 4, end: 8 });
    expect(lineIndex.positionAtByteOffset(2, "start")).toEqual({
      byteOffset: 2,
      characterOffset: 1,
      line: 1,
      column: 2,
    });
    expect(lineIndex.positionAtByteOffset(2, "end")).toEqual({
      byteOffset: 2,
      characterOffset: 2,
      line: 1,
      column: 3,
    });
    expect(lineIndex.positionAtByteOffset(4)).toEqual({
      byteOffset: 4,
      characterOffset: 3,
      line: 2,
      column: 1,
    });
  });

  it("rejects out-of-bounds lines and offsets", () => {
    const lineIndex = createLineIndex("a", buildIdentityOffsetMap(1).offsetMap);

    expect(() => lineIndex.lineStartOffset(0)).toThrow(RangeError);
    expect(() => lineIndex.lineEndOffset(2)).toThrow(RangeError);
    expect(() => lineIndex.positionAtTextOffset(-1)).toThrow(RangeError);
    expect(() => lineIndex.positionAtTextOffset(2)).toThrow(RangeError);
    expect(() => lineIndex.positionAtByteOffset(2)).toThrow(RangeError);
  });
});

function unwrapBuildResult(result: ReturnType<typeof buildUtf8OffsetMap>): OffsetMapBuildResult {
  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}
