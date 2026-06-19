import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import type { BackendDecodeOptions, RmemEncodingName, SourceMapMode } from "../src/index.js";
import { NATIVE_UNICODE_BACKEND, createDecoderRegistry } from "../src/decoder/index.js";
import {
  SINGLE_BYTE_ENCODING_NAMES,
  decodeSingleByteCodePoint,
  encodeSingleByteCodePoint,
  singleByteHighByteCodePointTable,
} from "../src/encoding/SingleByteEncoding.js";
import type { SingleByteEncodingName } from "../src/encoding/SingleByteEncoding.js";
import { normalizeDecodeDocumentOptions } from "../src/encoding/OptionsNormalization.js";

interface SingleByteDecodeCase {
  readonly encoding: SingleByteEncodingName;
  readonly bytes: readonly number[];
  readonly text: string;
}

const SINGLE_BYTE_DECODE_CASES = Object.freeze([
  {
    encoding: "windows-1251",
    bytes: [0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2],
    text: "Привіт",
  },
  {
    encoding: "windows-1252",
    bytes: [0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x80],
    text: "Café – €",
  },
  {
    encoding: "iso-8859-1",
    bytes: [0xa3, 0x20, 0xc5, 0x6e, 0x67, 0x73, 0x74, 0x72, 0xf6, 0x6d],
    text: "£ Ångström",
  },
  {
    encoding: "iso-8859-5",
    bytes: [0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2],
    text: "Привет",
  },
  {
    encoding: "koi8-r",
    bytes: [0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4],
    text: "Привет",
  },
  {
    encoding: "cp866",
    bytes: [0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2],
    text: "Привет",
  },
] as const satisfies readonly SingleByteDecodeCase[]);

describe("native single-byte backend", () => {
  it("uses stable v1 mapping tables for all canonical single-byte encodings", () => {
    expect(SINGLE_BYTE_ENCODING_NAMES).toEqual([
      "windows-1251",
      "windows-1252",
      "iso-8859-1",
      "iso-8859-5",
      "koi8-r",
      "cp866",
    ]);

    for (const encoding of SINGLE_BYTE_ENCODING_NAMES) {
      expect(singleByteHighByteCodePointTable(encoding)).toHaveLength(128);
    }

    expect(decodeSingleByteCodePoint(0x80, "windows-1252")).toBe(0x20ac);
    expect(decodeSingleByteCodePoint(0x81, "windows-1252")).toBeUndefined();
    expect(decodeSingleByteCodePoint(0x98, "windows-1251")).toBeUndefined();
    expect(decodeSingleByteCodePoint(0x81, "iso-8859-1")).toBe(0x81);
    expect(decodeSingleByteCodePoint(0xa1, "iso-8859-5")).toBe(0x0401);
    expect(decodeSingleByteCodePoint(0xe3, "koi8-r")).toBe(0x0426);
    expect(decodeSingleByteCodePoint(0xf0, "cp866")).toBe(0x0401);
    expect(encodeSingleByteCodePoint(0x20ac, "windows-1252")).toBe(0x80);
    expect(encodeSingleByteCodePoint(0x0401, "windows-1251")).toBe(0xa8);
    expect(encodeSingleByteCodePoint(0x0401, "koi8-r")).toBe(0xb3);
    expect(encodeSingleByteCodePoint(0x1f600, "windows-1251")).toBeUndefined();
  });

  it("is selected by the decoder registry for exact single-byte source maps", () => {
    const registry = createDecoderRegistry([NATIVE_UNICODE_BACKEND]);
    const normalizedOptions = normalizeDecodeDocumentOptions({
      profile: "legacyCyrillic",
    });
    const selection = registry.selectDecoderBackend({
      encoding: "windows-1251",
      profile: normalizedOptions.profile,
      sourceMap: normalizedOptions.sourceMap,
      backendPreference: ["native"],
    });

    expect(selection.backend).toBe(NATIVE_UNICODE_BACKEND);
    expect(selection.info).toEqual({
      name: "native",
      version: "native-v1",
      exactSourceMap: true,
    });
    expect(selection.warnings).toEqual([]);
  });

  it("decodes each v1 single-byte encoding with exact one-byte source ranges", () => {
    for (const testCase of SINGLE_BYTE_DECODE_CASES) {
      const result = NATIVE_UNICODE_BACKEND.decode(
        new Uint8Array(testCase.bytes),
        decodeOptions(testCase.encoding),
      );

      expect(result.text).toBe(testCase.text);
      expect(result.warnings).toEqual([]);
      expect(result.offsetMapSegments).toEqual([
        {
          byteRange: { start: 0, end: testCase.bytes.length },
          textRange: { start: 0, end: testCase.text.length },
          kind: "identity",
        },
      ]);
      expect(result.offsetMap?.byteRangeForTextRange({ start: 1, end: 4 })).toEqual({
        start: 1,
        end: 4,
      });
      expect(result.offsetMap?.textRangeForByteRange({ start: 1, end: 4 })).toEqual({
        start: 1,
        end: 4,
      });
      expect(Object.isFrozen(result.warnings)).toBe(true);
    }
  });

  it("encodes each v1 single-byte encoding and roundtrips through native decode", () => {
    for (const testCase of SINGLE_BYTE_DECODE_CASES) {
      const result = NATIVE_UNICODE_BACKEND.encode(testCase.text, testCase.encoding);

      expect([...result.bytes]).toEqual(testCase.bytes);
      expect(result.warnings).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.warnings)).toBe(true);
      expect(
        NATIVE_UNICODE_BACKEND.decode(result.bytes, decodeOptions(testCase.encoding)).text,
      ).toBe(testCase.text);
    }
  });

  it("throws structured fatal errors for unmapped single-byte values", () => {
    expect(() =>
      NATIVE_UNICODE_BACKEND.decode(
        new Uint8Array([0x41, 0x81, 0x42]),
        decodeOptions("windows-1252"),
      ),
    ).toThrow(EncodingError);

    try {
      NATIVE_UNICODE_BACKEND.decode(
        new Uint8Array([0x41, 0x81, 0x42]),
        decodeOptions("windows-1252"),
      );
      throw new Error("Expected fatal single-byte decode failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 2 });
      expect((error as EncodingError).details).toMatchObject({
        encoding: "windows-1252",
        reason: "Unmapped single-byte value.",
      });
    }
  });

  it("replaces unmapped single-byte values with warnings and replacement segments", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0x41, 0x81, 0x42]), {
      ...decodeOptions("windows-1252"),
      replacementPolicy: "replace",
      replacementCharacter: "?",
    });

    expect(result.text).toBe("A?B");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 2 },
      details: {
        encoding: "windows-1252",
        reason: "Unmapped single-byte value.",
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
        textRange: { start: 1, end: 2 },
        kind: "replacement",
      },
      {
        byteRange: { start: 2, end: 3 },
        textRange: { start: 2, end: 3 },
        kind: "identity",
      },
    ]);
  });

  it("can suppress source map output without suppressing unmapped-byte warnings", () => {
    const result = NATIVE_UNICODE_BACKEND.decode(new Uint8Array([0x81]), {
      ...decodeOptions("windows-1252", "none"),
      replacementPolicy: "replace",
    });

    expect(result.text).toBe("\uFFFD");
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_INVALID_SEQUENCE_REPLACED",
    ]);
    expect(result.offsetMap).toBeUndefined();
    expect(result.offsetMapSegments).toBeUndefined();
  });

  it("handles characters unsupported by single-byte encodings through fatal and replace policies", () => {
    expect(() => NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00B", "windows-1251")).toThrow(
      EncodingError,
    );

    try {
      NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00B", "windows-1251");
      throw new Error("Expected fatal single-byte encode failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNMAPPABLE_CHARACTER");
      expect((error as EncodingError).textRange).toEqual({ start: 1, end: 3 });
      expect((error as EncodingError).details).toMatchObject({
        backend: "native",
        encoding: "windows-1251",
        codePoint: "U+1F600",
        reason: "Character is not representable in target encoding.",
      });
    }

    const defaultReplacement = NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00B", "windows-1251", {
      replacementPolicy: "replace",
    });
    const customReplacement = NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00", "windows-1251", {
      replacementPolicy: "replace",
      replacementCharacter: "\u0416",
    });

    expect([...defaultReplacement.bytes]).toEqual([0x41, 0x3f, 0x42]);
    expect(defaultReplacement.warnings).toHaveLength(1);
    expect(defaultReplacement.warnings[0]).toMatchObject({
      code: "ENCODING_UNMAPPABLE_CHARACTER_REPLACED",
      textRange: { start: 1, end: 3 },
      details: {
        backend: "native",
        encoding: "windows-1251",
        codePoint: "U+1F600",
        replacementCharacter: "?",
      },
    });
    expect([...customReplacement.bytes]).toEqual([0x41, 0xc6]);
    expect(customReplacement.warnings[0]).toMatchObject({
      details: {
        replacementCharacter: "\u0416",
      },
    });

    expect(() =>
      NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00", "windows-1251", {
        replacementPolicy: "replace",
        replacementCharacter: "\ud83d\ude00",
      }),
    ).toThrow(EncodingError);

    try {
      NATIVE_UNICODE_BACKEND.encode("A\ud83d\ude00", "windows-1251", {
        replacementPolicy: "replace",
        replacementCharacter: "\ud83d\ude00",
      });
      throw new Error("Expected unencodable replacement character to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toMatchObject({
        backend: "native",
        encoding: "windows-1251",
        replacementCharacter: "\ud83d\ude00",
        reason: "replacement-character-unencodable",
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
