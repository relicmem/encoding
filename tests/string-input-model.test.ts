import { describe, expect, it } from "vitest";

import { buildSyntheticUtf8StringOffsetMap } from "../src/source/OffsetMapBuilder.js";
import { createDecodedStringDocument } from "../src/source/StringInput.js";

const UTF8_ENCODER = new TextEncoder();

describe("string input model", () => {
  it("assembles already-decoded string documents with synthetic UTF-8 source bytes", () => {
    const text = "AЖ\n😀";
    const expectedBytes = UTF8_ENCODER.encode(text);
    const document = createDecodedStringDocument(text, { explicitEncoding: "windows-1251" });

    expect(document.text).toBe(text);
    expect([...document.bytes]).toEqual([...expectedBytes]);
    expect([...document.source.bytes]).toEqual([...expectedBytes]);
    expect(document.warnings).toEqual([]);
    expect(Object.isFrozen(document)).toBe(true);

    const firstBytesRead = document.bytes;
    firstBytesRead[0] = 0x00;
    expect([...document.bytes]).toEqual([...expectedBytes]);

    expect(document.detection).toMatchObject({
      encoding: "windows-1251",
      confidence: 1,
      source: "explicit",
      bomLength: 0,
      warnings: [],
      label: {
        inputLabel: "windows-1251",
        canonical: "windows-1251",
        aliases: ["cp1251", "windows1251", "win1251", "x-cp1251"],
        source: "explicit",
      },
      backend: {
        name: "native",
        exactSourceMap: true,
      },
    });
    expect(document.detection.candidates).toEqual([
      {
        encoding: "windows-1251",
        confidence: 1,
        source: "explicit",
        reason:
          "Already-decoded string input used the explicit encoding label without detection heuristics.",
        bomLength: 0,
      },
    ]);

    expect(document.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "synthetic",
      },
      {
        byteRange: { start: 1, end: 3 },
        textRange: { start: 1, end: 2 },
        kind: "synthetic",
      },
      {
        byteRange: { start: 3, end: 4 },
        textRange: { start: 2, end: 3 },
        kind: "synthetic",
      },
      {
        byteRange: { start: 4, end: 8 },
        textRange: { start: 3, end: 5 },
        kind: "synthetic",
      },
    ]);
    expect(document.lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 4 });
    expect(document.lineIndex.lineByteRange(2)).toEqual({ start: 4, end: 8 });
  });

  it("warns when exact source map is requested for text input", () => {
    const document = createDecodedStringDocument("abc", { sourceMap: "exact" });

    expect(document.detection.encoding).toBe("utf-8");
    expect(document.detection.source).toBe("explicit");
    expect(document.detection.label).toEqual({
      inputLabel: "utf-8",
      canonical: "utf-8",
      aliases: ["utf8", "unicode-1-1-utf-8"],
      source: "default",
    });
    expect(document.detection.warnings).toEqual([]);
    expect(document.warnings).toEqual([
      {
        code: "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
        severity: "warning",
        message:
          "String input uses synthetic UTF-8 bytes; source ranges do not reference original bytes.",
        byteRange: { start: 0, end: 3 },
        textRange: { start: 0, end: 3 },
        details: {
          declaredEncoding: "utf-8",
          syntheticEncoding: "utf-8",
          sourceMap: "exact",
        },
      },
    ]);
    expect(document.offsetMap.segments().map((segment) => segment.kind)).toEqual([
      "synthetic",
      "synthetic",
      "synthetic",
    ]);
  });

  it("uses default encoding metadata without changing synthetic UTF-8 bytes", () => {
    const document = createDecodedStringDocument("x", { defaultEncoding: "utf-16le" });

    expect(document.detection.encoding).toBe("utf-16le");
    expect(document.detection.label).toEqual({
      inputLabel: "utf-16le",
      canonical: "utf-16le",
      aliases: ["utf16le", "utf-16-le", "utf-16 little endian"],
      source: "default",
    });
    expect([...document.bytes]).toEqual([0x78]);

    const implicitDefault = createDecodedStringDocument("x");
    expect(implicitDefault.detection.encoding).toBe("utf-8");
    expect(implicitDefault.detection.label.inputLabel).toBe("utf-8");
  });

  it("uses registry webCompat remapping for already-decoded string labels", () => {
    const document = createDecodedStringDocument("x", {
      explicitEncoding: "latin1",
      profile: "webCompat",
    });

    expect(document.detection.encoding).toBe("windows-1252");
    expect(document.detection.label).toMatchObject({
      inputLabel: "latin1",
      canonical: "windows-1252",
      source: "explicit",
    });
    expect(document.detection.label.aliases).toContain("iso-8859-1");
  });

  it("builds synthetic maps for surrogate pairs and unpaired surrogates", () => {
    const text = "a\uD800\uD83D\uDE00";
    const result = buildSyntheticUtf8StringOffsetMap(text);

    expect(result.textLength).toBe(text.length);
    expect([...result.bytes]).toEqual([...UTF8_ENCODER.encode(text)]);
    expect(result.segments).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "synthetic",
      },
      {
        byteRange: { start: 1, end: 4 },
        textRange: { start: 1, end: 2 },
        kind: "synthetic",
      },
      {
        byteRange: { start: 4, end: 8 },
        textRange: { start: 2, end: 4 },
        kind: "synthetic",
      },
    ]);
    expect(result.offsetMap.byteRangeForTextRange({ start: 1, end: 2 })).toEqual({
      start: 1,
      end: 4,
    });
  });
});
