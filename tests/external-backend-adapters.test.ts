import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import {
  NATIVE_UNICODE_BACKEND,
  createDecoderRegistry,
  createIconvLiteBackend,
  createTextDecoderBackend,
  isTextDecoderBackendAvailable,
} from "../src/decoder/index.js";
import type { BackendDecodeOptions, RelicMEMEncodingName, SourceMapMode } from "../src/index.js";
import type { IconvLiteLike } from "../src/decoder/ExternalDecoderBackends.js";
import { normalizeDecodeDocumentOptions } from "../src/encoding/OptionsNormalization.js";

describe("external decoder backend adapters", () => {
  it("creates a TextDecoder adapter without adding an optional package dependency", () => {
    expect(isTextDecoderBackendAvailable()).toBe(true);

    const backend = createTextDecoderBackend({
      version: "runtime-test",
    });

    expect(backend.info).toEqual({
      name: "text-decoder",
      version: "runtime-test",
      exactSourceMap: false,
    });
    expect(backend.canDecode("utf-8")).toBe(true);
    expect(backend.canDecode("iso-8859-1")).toBe(false);
    expect(backend.canEncode("utf-8")).toBe(false);
    expect(Object.isFrozen(backend)).toBe(true);
    expect(Object.isFrozen(backend.info)).toBe(true);
  });

  it("decodes through TextDecoder only when source maps are explicitly disabled", () => {
    const backend = createTextDecoderBackend();
    const input = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xd0, 0x96]);
    const stripped = backend.decode(input, decodeOptions("utf-8", "none"));
    const preserved = backend.decode(input, {
      ...decodeOptions("utf-8", "none"),
      stripBom: false,
    });

    expect(stripped.text).toBe("AЖ");
    expect(stripped.warnings).toEqual([]);
    expect(stripped.offsetMap).toBeUndefined();
    expect(stripped.offsetMapSegments).toBeUndefined();
    expect(preserved.text).toBe("\uFEFFAЖ");
    expect(Object.isFrozen(stripped)).toBe(true);
    expect(Object.isFrozen(stripped.warnings)).toBe(true);
  });

  it("keeps non-exact TextDecoder behind the registry source map capability guard", () => {
    const textDecoder = createTextDecoderBackend();
    const registry = createDecoderRegistry([textDecoder, NATIVE_UNICODE_BACKEND]);
    const normalizedOptions = normalizeDecodeDocumentOptions();
    const selection = registry.selectDecoderBackend({
      encoding: "utf-8",
      profile: normalizedOptions.profile,
      sourceMap: normalizedOptions.sourceMap,
      backendPreference: ["text-decoder", "native"],
    });

    expect(selection.backend).toBe(NATIVE_UNICODE_BACKEND);
    expect(selection.skippedBackends).toEqual([
      {
        backend: "text-decoder",
        reason: "exact-source-map-unavailable",
        info: textDecoder.info,
      },
    ]);
    expect(selection.warnings[0]).toMatchObject({
      code: "ENCODING_BACKEND_SUBSTITUTION",
      details: {
        requestedBackend: "text-decoder",
        selectedBackend: "native",
        reason: "exact-source-map-unavailable",
      },
    });
  });

  it("allows TextDecoder selection only after explicit source map opt-out", () => {
    const textDecoder = createTextDecoderBackend();
    const registry = createDecoderRegistry([textDecoder, NATIVE_UNICODE_BACKEND]);
    const normalizedOptions = normalizeDecodeDocumentOptions({
      sourceMap: "none",
    });
    const selection = registry.selectDecoderBackend({
      encoding: "utf-8",
      profile: normalizedOptions.profile,
      sourceMap: normalizedOptions.sourceMap,
      backendPreference: ["text-decoder", "native"],
    });

    expect(selection.backend).toBe(textDecoder);
    expect(selection.info).toMatchObject({
      name: "text-decoder",
      exactSourceMap: false,
    });
    expect(selection.warnings).toEqual([]);
  });

  it("rejects direct TextDecoder source map requests with a structured fatal error", () => {
    const backend = createTextDecoderBackend();

    expect(() => backend.decode(new Uint8Array([0x41]), decodeOptions("utf-8"))).toThrow(
      EncodingError,
    );

    try {
      backend.decode(new Uint8Array([0x41]), decodeOptions("utf-8"));
      throw new Error("Expected TextDecoder exact source map request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
      expect((error as EncodingError).details).toEqual({
        backend: "text-decoder",
        encoding: "utf-8",
        sourceMap: "exact",
        exactSourceMap: false,
      });
    }
  });

  it("uses controlled native preflight for TextDecoder fatal invalid ranges", () => {
    const backend = createTextDecoderBackend();

    try {
      backend.decode(new Uint8Array([0x41, 0xc3, 0x28]), decodeOptions("utf-8", "none"));
      throw new Error("Expected TextDecoder fatal invalid sequence to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 2 });
      expect((error as EncodingError).details).toMatchObject({
        backend: "text-decoder",
        validationBackend: "native",
        encoding: "utf-8",
        reason: "Invalid UTF-8 continuation byte.",
      });
    }
  });

  it("adds replacement warnings with ranges for TextDecoder replacement decoding", () => {
    const backend = createTextDecoderBackend();
    const result = backend.decode(new Uint8Array([0x41, 0xc3, 0x28]), {
      ...decodeOptions("utf-8", "none"),
      replacementPolicy: "replace",
    });

    expect(result.text).toBe("A\uFFFD(");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 2 },
      details: {
        backend: "text-decoder",
        validationBackend: "native",
        encoding: "utf-8",
        replacementCharacter: "\uFFFD",
      },
    });
  });

  it("wraps an injected iconv-lite compatible decoder as an optional non-exact backend", () => {
    const calls: string[] = [];
    const iconvLite: IconvLiteLike = {
      version: "mock-iconv-1",
      encodingExists(encoding) {
        return encoding === "windows-1251";
      },
      decode(input, encoding, options) {
        calls.push(`${encoding}:${String(input.byteLength)}:${String(options?.stripBOM)}`);

        return "Привіт";
      },
    };
    const backend = createIconvLiteBackend(iconvLite);
    const result = backend.decode(new Uint8Array([0xcf, 0xf0, 0xe8]), {
      ...decodeOptions("windows-1251", "none"),
      replacementPolicy: "replace",
    });

    expect(backend.info).toEqual({
      name: "iconv-lite",
      version: "mock-iconv-1",
      exactSourceMap: false,
    });
    expect(backend.canDecode("windows-1251")).toBe(true);
    expect(backend.canDecode("utf-8")).toBe(false);
    expect(result).toEqual({
      text: "Привіт",
      warnings: [],
    });
    expect(calls).toEqual(["windows-1251:3:true"]);
  });

  it("adds controlled replacement warnings when iconv-lite matches native replacement text", () => {
    const backend = createIconvLiteBackend({
      encodingExists: (encoding) => encoding === "windows-1252",
      decode: () => "\uFFFD",
    });
    const result = backend.decode(new Uint8Array([0x81]), {
      ...decodeOptions("windows-1252", "none"),
      replacementPolicy: "replace",
    });

    expect(result.text).toBe("\uFFFD");
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 0, end: 1 },
      textRange: { start: 0, end: 1 },
      details: {
        backend: "iconv-lite",
        validationBackend: "native",
        encoding: "windows-1252",
      },
    });
  });

  it("rejects iconv-lite replacement output when warnings would point at the wrong text", () => {
    const backend = createIconvLiteBackend({
      encodingExists: (encoding) => encoding === "windows-1252",
      decode: () => "\u0081",
    });

    expect(() =>
      backend.decode(new Uint8Array([0x81]), {
        ...decodeOptions("windows-1252", "none"),
        replacementPolicy: "replace",
      }),
    ).toThrow(EncodingError);

    try {
      backend.decode(new Uint8Array([0x81]), {
        ...decodeOptions("windows-1252", "none"),
        replacementPolicy: "replace",
      });
      throw new Error("Expected iconv-lite replacement mismatch to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toMatchObject({
        backend: "iconv-lite",
        validationBackend: "native",
        encoding: "windows-1252",
        replacementPolicy: "replace",
      });
    }
  });

  it("does not let the iconv-lite adapter claim unsupported capabilities", () => {
    const backend = createIconvLiteBackend({
      encodingExists: () => true,
      decode: () => "text",
    });

    expect(() => backend.decode(new Uint8Array([0x41]), decodeOptions("utf-8"))).toThrow(
      EncodingError,
    );
    expect(() =>
      backend.decode(new Uint8Array([0x41]), {
        ...decodeOptions("utf-8", "none"),
        replacementPolicy: "fatal",
      }),
    ).toThrow(EncodingError);

    try {
      backend.decode(new Uint8Array([0x41]), {
        ...decodeOptions("utf-8", "none"),
        replacementPolicy: "fatal",
      });
      throw new Error("Expected iconv-lite fatal policy request to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toMatchObject({
        backend: "iconv-lite",
        encoding: "utf-8",
      });
    }
  });
});

function decodeOptions(
  encoding: RelicMEMEncodingName,
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
