import { describe, expect, expectTypeOf, it } from "vitest";

import {
  EncodingError,
  canEncodeText,
  decodeDocumentSync,
  encodeText,
  tryEncodeText,
} from "../src/index.js";
import type {
  CanEncodeTextFunction,
  EncodeTextFunction,
  TryEncodeTextFunction,
} from "../src/index.js";

const ASCII_TRIGGER_TEXT = "#*-[]()";
const ASCII_TRIGGER_BYTES = Object.freeze([0x23, 0x2a, 0x2d, 0x5b, 0x5d, 0x28, 0x29]);

describe("public encode API", () => {
  it("exports stable root functions with public function contracts", () => {
    expectTypeOf(encodeText).toEqualTypeOf<EncodeTextFunction>();
    expectTypeOf(tryEncodeText).toEqualTypeOf<TryEncodeTextFunction>();
    expectTypeOf(canEncodeText).toEqualTypeOf<CanEncodeTextFunction>();
  });

  it("encodes UTF-8 and UTF-16 fragments without a BOM", () => {
    const text = "A\u0416\ud83d\ude00";
    const utf8 = encodeText(text, "utf-8");
    const utf16le = encodeText(text, "utf-16le");
    const utf16be = encodeText(text, "utf-16be");

    expect([...utf8.bytes]).toEqual([0x41, 0xd0, 0x96, 0xf0, 0x9f, 0x98, 0x80]);
    expect([...utf16le.bytes]).toEqual([0x41, 0x00, 0x16, 0x04, 0x3d, 0xd8, 0x00, 0xde]);
    expect([...utf16be.bytes]).toEqual([0x00, 0x41, 0x04, 0x16, 0xd8, 0x3d, 0xde, 0x00]);
    expect(utf8.warnings).toEqual([]);
    expect(utf8).toMatchObject({
      encoding: "utf-8",
      label: {
        inputLabel: "utf-8",
        canonical: "utf-8",
        source: "explicit",
      },
      backend: {
        name: "native",
        exactSourceMap: true,
      },
    });
  });

  it("encodes supported single-byte fragments and ASCII triggers", () => {
    const windows1251 = encodeText("Привіт", "win1251");
    const windows1252 = encodeText("Café – €", "windows-1252");
    const ascii = encodeText(ASCII_TRIGGER_TEXT, "windows-1251");

    expect([...windows1251.bytes]).toEqual([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]);
    expect(windows1251.encoding).toBe("windows-1251");
    expect(windows1251.label.inputLabel).toBe("win1251");
    expect([...windows1252.bytes]).toEqual([0x43, 0x61, 0x66, 0xe9, 0x20, 0x96, 0x20, 0x80]);
    expect([...ascii.bytes]).toEqual(ASCII_TRIGGER_BYTES);
  });

  it("roundtrips encoded bytes through the public decode API", () => {
    const text = "Привіт";
    const encoded = encodeText(text, "windows-1251");
    const decoded = decodeDocumentSync(encoded.bytes, {
      explicitEncoding: encoded.encoding,
    });

    expect(decoded.text).toBe(text);
    expect(decoded.detection.encoding).toBe("windows-1251");
  });

  it("returns structured failures for unsupported labels without throwing from tryEncodeText", () => {
    const result = tryEncodeText("text", "unknown-encoding");

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected unsupported label to fail.");
    }

    expect(result.error).toBeInstanceOf(EncodingError);
    expect(result.error.code).toBe("ENCODING_UNSUPPORTED_LABEL");
    expect(result.error.details).toMatchObject({
      label: "unknown-encoding",
      source: "explicit",
    });
    expect(canEncodeText("text", "unknown-encoding")).toBe(false);
  });

  it("reports unmappable characters in fatal mode and replaces them in replace mode", () => {
    const input = "A\ud83d\ude00B";
    const fatal = tryEncodeText(input, "windows-1251");

    expect(fatal.ok).toBe(false);
    expect(canEncodeText(input, "windows-1251")).toBe(false);

    if (fatal.ok) {
      throw new Error("Expected unmappable character to fail.");
    }

    expect(fatal.error.code).toBe("ENCODING_UNMAPPABLE_CHARACTER");
    expect(fatal.error.textRange).toEqual({ start: 1, end: 3 });
    expect(fatal.error.details).toMatchObject({
      backend: "native",
      encoding: "windows-1251",
      codePoint: "U+1F600",
      reason: "Character is not representable in target encoding.",
    });

    const replaced = encodeText(input, "windows-1251", {
      replacementPolicy: "replace",
    });

    expect(canEncodeText(input, "windows-1251", { replacementPolicy: "replace" })).toBe(true);
    expect([...replaced.bytes]).toEqual([0x41, 0x3f, 0x42]);
    expect(replaced.warnings).toHaveLength(1);
    expect(replaced.warnings[0]).toMatchObject({
      code: "ENCODING_UNMAPPABLE_CHARACTER_REPLACED",
      textRange: { start: 1, end: 3 },
      details: {
        backend: "native",
        encoding: "windows-1251",
        codePoint: "U+1F600",
        replacementCharacter: "?",
      },
    });
  });

  it("returns structured failures when replacement bytes cannot be encoded", () => {
    const result = tryEncodeText("A\ud83d\ude00", "windows-1251", {
      replacementPolicy: "replace",
      replacementCharacter: "\ud83d\ude00",
    });

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected unencodable replacement character to fail.");
    }

    expect(result.error.code).toBe("ENCODING_UNSUPPORTED_ENCODING");
    expect(result.error.details).toMatchObject({
      backend: "native",
      encoding: "windows-1251",
      replacementCharacter: "\ud83d\ude00",
      reason: "replacement-character-unencodable",
    });
  });
});
