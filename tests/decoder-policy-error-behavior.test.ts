import { describe, expect, it } from "vitest";

import { EncodingError, decodeDocumentSync, tryDecodeDocument } from "../src/index.js";
import type { EncodingWarning } from "../src/index.js";
import { isTextDecoderBackendAvailable } from "../src/decoder/ExternalDecoderBackends.js";

describe("decoder policy, warning and error behavior", () => {
  it("rejects invalid UTF-8 under fatal policy without returning a partial document", async () => {
    const invalidUtf8 = new Uint8Array([0x41, 0xc3, 0x28, 0x42]);

    expect(() =>
      decodeDocumentSync(invalidUtf8, {
        explicitEncoding: "utf-8",
        replacementPolicy: "fatal",
      }),
    ).toThrow(EncodingError);

    const result = await tryDecodeDocument(invalidUtf8, {
      explicitEncoding: "utf-8",
      replacementPolicy: "fatal",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("value" in result).toBe(false);
      expect(result.error).toMatchObject({
        code: "ENCODING_INVALID_SEQUENCE",
        byteRange: { start: 1, end: 2 },
        warnings: [],
        details: {
          encoding: "utf-8",
          reason: "Invalid UTF-8 continuation byte.",
        },
      });
      expectEnglishDiagnosticMessage(result.error.message);
    }
  });

  it("rejects invalid UTF-16 under fatal policy with the invalid byte range", async () => {
    const invalidUtf16 = new Uint8Array([0x41, 0x00, 0x3d, 0xd8, 0x42, 0x00]);
    const result = await tryDecodeDocument(invalidUtf16, {
      explicitEncoding: "utf-16le",
      replacementPolicy: "fatal",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect("value" in result).toBe(false);
      expect(result.error).toMatchObject({
        code: "ENCODING_INVALID_SEQUENCE",
        byteRange: { start: 2, end: 4 },
        warnings: [],
        details: {
          encoding: "utf-16le",
          reason: "Unpaired UTF-16 high surrogate.",
        },
      });
      expectEnglishDiagnosticMessage(result.error.message);
    }
  });

  it("replaces invalid sequences with the configured character, warnings and replacement ranges", () => {
    const document = decodeDocumentSync(new Uint8Array([0x41, 0xc3, 0x28, 0x42]), {
      explicitEncoding: "utf-8",
      replacementPolicy: "replace",
      replacementCharacter: "??",
      sourceMap: "exact",
    });
    const warning = requireWarning(document.warnings, "ENCODING_INVALID_SEQUENCE_REPLACED");

    expect(document.text).toBe("A??(B");
    expect(document.detection).toMatchObject({
      encoding: "utf-8",
      source: "explicit",
      confidence: 1,
    });
    expect(warning).toMatchObject({
      severity: "warning",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 3 },
      details: {
        backend: "native",
        encoding: "utf-8",
        replacementCharacter: "??",
        reason: "Invalid UTF-8 continuation byte.",
      },
    });
    expect(document.offsetMap.segments()).toContainEqual({
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 3 },
      kind: "replacement",
    });
    expect(document.offsetMap.byteRangeForTextRange({ start: 1, end: 3 })).toEqual({
      start: 1,
      end: 2,
    });
    expectEnglishDiagnosticMessage(warning.message);
  });

  it("surfaces backend substitution warnings before decoder replacement warnings", () => {
    const document = decodeDocumentSync(new Uint8Array([0x41, 0xc3, 0x28]), {
      explicitEncoding: "utf-8",
      replacementPolicy: "replace",
      backendPreference: ["text-decoder", "native"],
    });

    expect(document.text).toBe("A\uFFFD(");
    expect(document.detection.backend).toMatchObject({
      name: "native",
      exactSourceMap: true,
    });
    expect(document.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_BACKEND_SUBSTITUTION",
      "ENCODING_INVALID_SEQUENCE_REPLACED",
    ]);
    expect(document.warnings[0]).toMatchObject({
      details: {
        requestedBackend: "text-decoder",
        selectedBackend: "native",
        reason: "exact-source-map-unavailable",
      },
    });
    for (const warning of document.warnings) {
      expectEnglishDiagnosticMessage(warning.message);
    }
  });

  it("fails when an exact source map is required but the selected backend cannot provide it", () => {
    expect(isTextDecoderBackendAvailable()).toBe(true);

    try {
      decodeDocumentSync(new Uint8Array([0x41]), {
        explicitEncoding: "utf-8",
        sourceMap: "exact",
        backendPreference: ["text-decoder"],
      });
      throw new Error("Expected exact source map capability failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect(error).toMatchObject({
        code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
        details: {
          encoding: "utf-8",
          sourceMap: "exact",
          exactSourceMapRequired: true,
          requestedBackends: ["text-decoder"],
        },
      });
      expect((error as EncodingError).details?.skippedBackends).toEqual([
        {
          backend: "text-decoder",
          reason: "exact-source-map-unavailable",
          exactSourceMap: false,
        },
      ]);
      expectEnglishDiagnosticMessage((error as EncodingError).message);
    }
  });

  it("reports unsupported labels and backend preferences as structured English diagnostics", () => {
    expect(() =>
      decodeDocumentSync(new Uint8Array([0x41]), {
        explicitEncoding: "utf-32",
      }),
    ).toThrow(EncodingError);

    try {
      decodeDocumentSync(new Uint8Array([0x41]), {
        explicitEncoding: "utf-32",
      });
      throw new Error("Expected unsupported encoding label.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect(error).toMatchObject({
        code: "ENCODING_UNSUPPORTED_LABEL",
        details: {
          label: "utf-32",
          source: "explicit",
        },
      });
      expectEnglishDiagnosticMessage((error as EncodingError).message);
    }

    try {
      decodeDocumentSync(new Uint8Array([0x41]), {
        explicitEncoding: "utf-8",
        backendPreference: ["iconv-lite"],
      });
      throw new Error("Expected unsupported backend selection.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect(error).toMatchObject({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        details: {
          encoding: "utf-8",
          requestedBackends: ["iconv-lite"],
          skippedBackends: [
            {
              backend: "iconv-lite",
              reason: "not-registered",
            },
          ],
        },
      });
      expectEnglishDiagnosticMessage((error as EncodingError).message);
    }
  });
});

function requireWarning(
  warnings: readonly EncodingWarning[],
  code: EncodingWarning["code"],
): EncodingWarning {
  const warning = warnings.find((candidate) => candidate.code === code);

  if (warning === undefined) {
    throw new Error(`Expected warning ${code}.`);
  }

  return warning;
}

function expectEnglishDiagnosticMessage(message: string): void {
  expect(message).toMatch(/[A-Za-z]/);
  expect(message).not.toMatch(/[А-Яа-яІіЇїЄєҐґ]/u);
}
