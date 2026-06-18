import { describe, expect, it } from "vitest";

import {
  EncodingError,
  NATIVE_UNICODE_BACKEND,
  createDecoderRegistry,
  createNativeUnicodeBackend,
} from "../src/index.js";
import type { BackendDecodeOptions, RmemEncodingName, SourceMapMode } from "../src/index.js";
import { normalizeDecodeDocumentOptions } from "../src/encoding/OptionsNormalization.js";

describe("native Unicode backend", () => {
  it("advertises exact source maps for UTF-8 and UTF-16 decoding only", () => {
    const backend = createNativeUnicodeBackend();

    expect(backend.info).toEqual({
      name: "native",
      version: "unicode-v1",
      exactSourceMap: true,
    });
    expect(backend.canDecode("utf-8")).toBe(true);
    expect(backend.canDecode("utf-16le")).toBe(true);
    expect(backend.canDecode("utf-16be")).toBe(true);
    expect(backend.canDecode("windows-1251")).toBe(false);
    expect(backend.canEncode("utf-8")).toBe(false);
    expect(Object.isFrozen(backend)).toBe(true);
    expect(Object.isFrozen(backend.info)).toBe(true);
  });

  it("can be selected by the decoder registry for exact source maps", () => {
    const registry = createDecoderRegistry([NATIVE_UNICODE_BACKEND]);
    const normalizedOptions = normalizeDecodeDocumentOptions();
    const selection = registry.selectDecoderBackend({
      encoding: "utf-16le",
      profile: normalizedOptions.profile,
      sourceMap: normalizedOptions.sourceMap,
      backendPreference: ["native"],
    });

    expect(selection.backend).toBe(NATIVE_UNICODE_BACKEND);
    expect(selection.info).toEqual({
      name: "native",
      version: "unicode-v1",
      exactSourceMap: true,
    });
    expect(selection.warnings).toEqual([]);
  });

  it("decodes UTF-8 text while keeping exact BOM and multibyte source map segments", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xd0, 0x96, 0xf0, 0x9f, 0x98, 0x80]),
      decodeOptions("utf-8"),
    );

    expect(result.text).toBe("A\u0416\ud83d\ude00");
    expect(result.warnings).toEqual([]);
    expect(result.offsetMapSegments).toEqual([
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
    expect(result.offsetMap?.byteRangeForTextRange({ start: 2, end: 4 })).toEqual({
      start: 6,
      end: 10,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it("preserves UTF-8 BOM in decoded text when stripBom is disabled", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), {
      ...decodeOptions("utf-8"),
      stripBom: false,
    });

    expect(result.text).toBe("\uFEFFA");
    expect(result.offsetMapSegments?.[0]).toEqual({
      byteRange: { start: 0, end: 3 },
      textRange: { start: 0, end: 1 },
      kind: "bom",
    });
    expect(result.offsetMap?.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("throws a structured fatal UTF-8 error with the invalid byte range", () => {
    expect(() =>
      NATIVE_UNICODE_BACKEND.decode(
        new Uint8Array([0x41, 0xc3, 0x28, 0x42]),
        decodeOptions("utf-8"),
      ),
    ).toThrow(EncodingError);

    try {
      NATIVE_UNICODE_BACKEND.decode(
        new Uint8Array([0x41, 0xc3, 0x28, 0x42]),
        decodeOptions("utf-8"),
      );
      throw new Error("Expected fatal UTF-8 decode failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 2 });
      expect((error as EncodingError).details).toMatchObject({
        encoding: "utf-8",
        reason: "Invalid UTF-8 continuation byte.",
      });
    }
  });

  it("replaces invalid UTF-8 sequences with warning ranges and replacement segments", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0x41, 0xc3, 0x28, 0x42]), {
      ...decodeOptions("utf-8"),
      replacementPolicy: "replace",
      replacementCharacter: "??",
    });

    expect(result.text).toBe("A??(B");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 3 },
      details: {
        encoding: "utf-8",
        reason: "Invalid UTF-8 continuation byte.",
      },
    });
    expect(result.offsetMapSegments).toEqual([
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

  it("decodes UTF-16LE BOM input with surrogate pairs and exact source ranges", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(
      new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x3d, 0xd8, 0x00, 0xde]),
      decodeOptions("utf-16le"),
    );

    expect(result.text).toBe("A\ud83d\ude00");
    expect(result.offsetMapSegments).toEqual([
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
    expect(result.offsetMap?.byteRangeForTextRange({ start: 1, end: 3 })).toEqual({
      start: 4,
      end: 8,
    });
  });

  it("decodes UTF-16BE and can preserve BOM text", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0xfe, 0xff, 0x00, 0x41]), {
      ...decodeOptions("utf-16be"),
      stripBom: false,
    });

    expect(result.text).toBe("\uFEFFA");
    expect(result.offsetMapSegments).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 1 },
        kind: "bom",
      },
      {
        byteRange: { start: 2, end: 4 },
        textRange: { start: 1, end: 2 },
        kind: "encoded",
      },
    ]);
  });

  it("handles invalid UTF-16 code units through fatal and replace policies", () => {
    const invalidHighSurrogate = new Uint8Array([0x3d, 0xd8, 0x41, 0x00]);

    try {
      NATIVE_UNICODE_BACKEND.decode(invalidHighSurrogate, decodeOptions("utf-16le"));
      throw new Error("Expected fatal UTF-16 decode failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 0, end: 2 });
      expect((error as EncodingError).details).toMatchObject({
        encoding: "utf-16le",
        reason: "Unpaired UTF-16 high surrogate.",
      });
    }

    const replaced = NATIVE_UNICODE_BACKEND.decode(invalidHighSurrogate, {
      ...decodeOptions("utf-16le"),
      replacementPolicy: "replace",
    });

    expect(replaced.text).toBe("\uFFFDA");
    expect(replaced.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 0, end: 2 },
      textRange: { start: 0, end: 1 },
    });
    expect(replaced.offsetMapSegments).toEqual([
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

  it("can suppress source map output without suppressing replacement warnings", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0x41, 0xc3, 0x28]), {
      ...decodeOptions("utf-8", "none"),
      replacementPolicy: "replace",
    });

    expect(result.text).toBe("A\uFFFD(");
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_INVALID_SEQUENCE_REPLACED",
    ]);
    expect(result.offsetMap).toBeUndefined();
    expect(result.offsetMapSegments).toBeUndefined();
  });

  it("does not claim native encode support before the encode task is implemented", () => {
    expect(() => NATIVE_UNICODE_BACKEND.encode("text", "utf-8")).toThrow(EncodingError);

    try {
      NATIVE_UNICODE_BACKEND.encode("text", "utf-8");
      throw new Error("Expected native encode support to be unavailable.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toMatchObject({
        backend: "native",
        encoding: "utf-8",
      });
    }
  });
});

function decodeOptions(
  encoding: RmemEncodingName,
  sourceMap: SourceMapMode = "exact",
): BackendDecodeOptions {
  return {
    encoding,
    stripBom: true,
    sourceMap,
    replacementPolicy: "fatal",
    replacementCharacter: "\uFFFD",
  };
}
