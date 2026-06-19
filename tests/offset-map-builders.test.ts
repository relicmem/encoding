import { describe, expect, it } from "vitest";

import {
  buildExactOffsetMap,
  buildIdentityOffsetMap,
  buildSingleByteOffsetMap,
  buildUtf16BeOffsetMap,
  buildUtf16LeOffsetMap,
  buildUtf8OffsetMap,
} from "../src/index.js";
import type { RmemEncodingName } from "../src/index.js";

const SINGLE_BYTE_ENCODINGS = [
  "windows-1251",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-5",
  "koi8-r",
  "cp866",
] as const satisfies readonly RmemEncodingName[];

describe("OffsetMap builders", () => {
  it("builds identity maps for byte-safe single-byte spans", () => {
    const result = buildIdentityOffsetMap(4);

    expect(result.textLength).toBe(4);
    expect(result.bomLength).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(result.segments).toEqual([
      {
        byteRange: { start: 0, end: 4 },
        textRange: { start: 0, end: 4 },
        kind: "identity",
      },
    ]);
    expect(result.offsetMap.byteRangeForTextRange({ start: 1, end: 3 })).toEqual({
      start: 1,
      end: 3,
    });
  });

  it("builds exact maps for every canonical single-byte encoding", () => {
    const bytes = new Uint8Array([0x41, 0xff, 0x80]);

    for (const encoding of SINGLE_BYTE_ENCODINGS) {
      const result = buildExactOffsetMap(bytes, { encoding });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw result.error;
      }

      expect(result.value.textLength).toBe(3);
      expect(result.value.segments).toEqual([
        {
          byteRange: { start: 0, end: 3 },
          textRange: { start: 0, end: 3 },
          kind: "identity",
        },
      ]);
    }
  });

  it("handles unmapped single-byte values through fatal and replace policies", () => {
    const fatal = buildExactOffsetMap(new Uint8Array([0x41, 0x81, 0x42]), {
      encoding: "windows-1252",
    });

    expect(fatal.ok).toBe(false);
    if (fatal.ok) {
      throw new Error("Expected fatal single-byte invalid sequence.");
    }
    expect(fatal.error.code).toBe("ENCODING_INVALID_SEQUENCE");
    expect(fatal.error.byteRange).toEqual({ start: 1, end: 2 });

    const replaced = buildSingleByteOffsetMap(new Uint8Array([0x41, 0x81, 0x42]), {
      encoding: "windows-1252",
      replacementPolicy: "replace",
      replacementCharacter: "??",
    });

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) {
      throw replaced.error;
    }
    expect(replaced.value.textLength).toBe(4);
    expect(replaced.value.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 3 },
      details: {
        encoding: "windows-1252",
        reason: "Unmapped single-byte value.",
      },
    });
    expect(replaced.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "identity",
      },
      {
        byteRange: { start: 1, end: 2 },
        textRange: { start: 1, end: 3 },
        kind: "replacement",
      },
      {
        byteRange: { start: 2, end: 3 },
        textRange: { start: 3, end: 4 },
        kind: "identity",
      },
    ]);
  });

  it("builds UTF-8 maps with BOM, ASCII identity and multibyte encoded segments", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xd0, 0x96, 0xf0, 0x9f, 0x98, 0x80]);
    const result = buildUtf8OffsetMap(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.bomLength).toBe(3);
    expect(result.value.textLength).toBe(4);
    expect(result.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 3 },
        textRange: { start: 0, end: 0 },
        kind: "bom",
      },
      {
        byteRange: { start: 3, end: 4 },
        textRange: { start: 0, end: 1 },
        kind: "identity",
      },
      {
        byteRange: { start: 4, end: 6 },
        textRange: { start: 1, end: 2 },
        kind: "encoded",
      },
      {
        byteRange: { start: 6, end: 10 },
        textRange: { start: 2, end: 4 },
        kind: "encoded",
      },
    ]);
    expect(result.value.offsetMap.byteRangeForTextRange({ start: 0, end: 4 })).toEqual({
      start: 3,
      end: 10,
    });
    expect(result.value.offsetMap.byteRangeForTextRange({ start: 2, end: 4 })).toEqual({
      start: 6,
      end: 10,
    });
    expect(result.value.offsetMap.byteOffsetForTextOffset(0)).toBe(3);
  });

  it("preserves UTF-8 BOM text when stripBom is disabled", () => {
    const result = buildUtf8OffsetMap(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), {
      stripBom: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.textLength).toBe(2);
    expect(result.value.segments[0]).toEqual({
      byteRange: { start: 0, end: 3 },
      textRange: { start: 0, end: 1 },
      kind: "bom",
    });
    expect(result.value.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("returns failure instead of a partial UTF-8 map for fatal invalid sequences", () => {
    const result = buildUtf8OffsetMap(new Uint8Array([0x41, 0xc3, 0x28, 0x42]));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected fatal UTF-8 invalid sequence.");
    }

    expect(result.error.code).toBe("ENCODING_INVALID_SEQUENCE");
    expect(result.error.byteRange).toEqual({ start: 1, end: 2 });
    expect("value" in result).toBe(false);
  });

  it("creates UTF-8 replacement segments and warnings in replace policy", () => {
    const result = buildUtf8OffsetMap(new Uint8Array([0x41, 0xc3, 0x28, 0x42]), {
      replacementPolicy: "replace",
      replacementCharacter: "??",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.textLength).toBe(5);
    expect(result.value.warnings).toHaveLength(1);
    expect(result.value.warnings[0]?.code).toBe("ENCODING_INVALID_SEQUENCE_REPLACED");
    expect(result.value.warnings[0]?.byteRange).toEqual({ start: 1, end: 2 });
    expect(result.value.warnings[0]?.textRange).toEqual({ start: 1, end: 3 });
    expect(result.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "identity",
      },
      {
        byteRange: { start: 1, end: 2 },
        textRange: { start: 1, end: 3 },
        kind: "replacement",
      },
      {
        byteRange: { start: 2, end: 4 },
        textRange: { start: 3, end: 5 },
        kind: "identity",
      },
    ]);
  });

  it("builds UTF-16LE maps with stripped BOM and surrogate pairs", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde]);
    const result = buildUtf16LeOffsetMap(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.bomLength).toBe(2);
    expect(result.value.textLength).toBe(3);
    expect(result.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 0 },
        kind: "bom",
      },
      {
        byteRange: { start: 2, end: 4 },
        textRange: { start: 0, end: 1 },
        kind: "encoded",
      },
      {
        byteRange: { start: 4, end: 8 },
        textRange: { start: 1, end: 3 },
        kind: "encoded",
      },
    ]);
    expect(result.value.offsetMap.byteRangeForTextRange({ start: 1, end: 3 })).toEqual({
      start: 4,
      end: 8,
    });
  });

  it("builds UTF-16BE maps without requiring BOM", () => {
    const bytes = new Uint8Array([0x00, 0x41, 0xd8, 0x3d, 0xde, 0x00]);
    const result = buildUtf16BeOffsetMap(bytes);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw result.error;
    }

    expect(result.value.bomLength).toBe(0);
    expect(result.value.textLength).toBe(3);
    expect(result.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 1 },
        kind: "encoded",
      },
      {
        byteRange: { start: 2, end: 6 },
        textRange: { start: 1, end: 3 },
        kind: "encoded",
      },
    ]);
  });

  it("handles UTF-16 invalid code units through fatal and replace policies", () => {
    const invalidHighSurrogate = new Uint8Array([0x3d, 0xd8, 0x41, 0x00]);
    const fatal = buildUtf16LeOffsetMap(invalidHighSurrogate);

    expect(fatal.ok).toBe(false);
    if (fatal.ok) {
      throw new Error("Expected fatal UTF-16 invalid sequence.");
    }
    expect(fatal.error.byteRange).toEqual({ start: 0, end: 2 });

    const replaced = buildUtf16LeOffsetMap(invalidHighSurrogate, {
      replacementPolicy: "replace",
    });

    expect(replaced.ok).toBe(true);
    if (!replaced.ok) {
      throw replaced.error;
    }
    expect(replaced.value.warnings).toHaveLength(1);
    expect(replaced.value.segments).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 1 },
        kind: "replacement",
      },
      {
        byteRange: { start: 2, end: 4 },
        textRange: { start: 1, end: 2 },
        kind: "encoded",
      },
    ]);
  });

  it("routes exact builder by canonical encoding family", () => {
    const utf8 = buildExactOffsetMap(new Uint8Array([0x41]), { encoding: "utf-8" });
    const utf16 = buildExactOffsetMap(new Uint8Array([0x00, 0x41]), { encoding: "utf-16be" });
    const singleByte = buildSingleByteOffsetMap(new Uint8Array([0x80]));

    expect(utf8.ok).toBe(true);
    expect(utf16.ok).toBe(true);
    expect(singleByte.ok).toBe(true);
  });
});
