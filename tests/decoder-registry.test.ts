import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import type {
  DecodeDocumentOptions,
  DecoderBackend,
  DecoderBackendName,
  RmemEncodingName,
} from "../src/index.js";
import { DecoderRegistry } from "../src/decoder/DecoderRegistry.js";
import type { SelectDecoderBackendOptions } from "../src/decoder/DecoderRegistry.js";
import { normalizeDecodeDocumentOptions } from "../src/encoding/OptionsNormalization.js";

describe("decoder backend registry", () => {
  it("selects the first preferred backend that supports decoding and required source maps", () => {
    const native = createTestBackend({
      name: "native",
      exactSourceMap: true,
      supportedDecodings: ["utf-8"],
    });
    const textDecoder = createTestBackend({
      name: "text-decoder",
      exactSourceMap: false,
      supportedDecodings: ["utf-8"],
    });
    const registry = new DecoderRegistry([textDecoder, native]);

    const selection = registry.selectDecoderBackend(
      selectionOptions("utf-8", {
        backendPreference: ["native", "text-decoder"],
      }),
    );

    expect(selection.backend).toBe(native);
    expect(selection.info).toEqual({
      name: "native",
      exactSourceMap: true,
    });
    expect(selection.warnings).toEqual([]);
    expect(selection.skippedBackends).toEqual([]);
    expect(registry.listBackendInfo()).toEqual([
      {
        name: "native",
        exactSourceMap: true,
      },
      {
        name: "text-decoder",
        exactSourceMap: false,
      },
    ]);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(Object.isFrozen(selection.info)).toBe(true);
    expect(Object.isFrozen(selection.warnings)).toBe(true);
    expect(Object.isFrozen(registry.listBackendInfo())).toBe(true);
  });

  it("substitutes an unsuitable preferred backend with a structured warning", () => {
    const textDecoder = createTestBackend({
      name: "text-decoder",
      exactSourceMap: false,
      supportedDecodings: ["utf-8"],
    });
    const native = createTestBackend({
      name: "native",
      exactSourceMap: true,
      supportedDecodings: ["utf-8"],
    });
    const registry = new DecoderRegistry([textDecoder, native]);

    const selection = registry.selectDecoderBackend(
      selectionOptions("utf-8", {
        profile: "rmem",
        backendPreference: ["text-decoder", "native"],
      }),
    );

    expect(selection.backend).toBe(native);
    expect(selection.skippedBackends).toEqual([
      {
        backend: "text-decoder",
        reason: "exact-source-map-unavailable",
        info: {
          name: "text-decoder",
          exactSourceMap: false,
        },
      },
    ]);
    expect(selection.warnings).toHaveLength(1);
    expect(selection.warnings[0]).toMatchObject({
      code: "ENCODING_BACKEND_SUBSTITUTION",
      message: "Decoder backend was substituted.",
      details: {
        encoding: "utf-8",
        profile: "rmem",
        sourceMap: "exact",
        requestedBackend: "text-decoder",
        selectedBackend: "native",
        reason: "exact-source-map-unavailable",
      },
    });
  });

  it("allows non-exact backends only when source maps are explicitly disabled", () => {
    const textDecoder = createTestBackend({
      name: "text-decoder",
      exactSourceMap: false,
      supportedDecodings: ["utf-8"],
    });
    const native = createTestBackend({
      name: "native",
      exactSourceMap: true,
      supportedDecodings: ["utf-8"],
    });
    const registry = new DecoderRegistry([textDecoder, native]);

    const selection = registry.selectDecoderBackend(
      selectionOptions("utf-8", {
        profile: "rmem",
        sourceMap: "none",
        backendPreference: ["text-decoder", "native"],
      }),
    );

    expect(selection.backend).toBe(textDecoder);
    expect(selection.info).toEqual({
      name: "text-decoder",
      exactSourceMap: false,
    });
    expect(selection.warnings).toEqual([]);
  });

  it("does not hide unsupported encodings behind backend fallback", () => {
    const registry = new DecoderRegistry([
      createTestBackend({
        name: "native",
        exactSourceMap: true,
        supportedDecodings: ["utf-8"],
      }),
      createTestBackend({
        name: "text-decoder",
        exactSourceMap: false,
        supportedDecodings: ["utf-8"],
      }),
    ]);

    try {
      registry.selectDecoderBackend(
        selectionOptions("windows-1251", {
          sourceMap: "none",
          backendPreference: ["native", "text-decoder"],
        }),
      );
      throw new Error("Expected unsupported encoding selection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toMatchObject({
        encoding: "windows-1251",
        sourceMap: "none",
        exactSourceMapRequired: false,
        requestedBackends: ["native", "text-decoder"],
        skippedBackends: [
          {
            backend: "native",
            reason: "decode-unsupported",
          },
          {
            backend: "text-decoder",
            reason: "decode-unsupported",
          },
        ],
      });
    }
  });

  it("fails when only non-exact backends can decode a required exact source map", () => {
    const registry = new DecoderRegistry([
      createTestBackend({
        name: "text-decoder",
        exactSourceMap: false,
        supportedDecodings: ["utf-8"],
      }),
    ]);

    expect(() =>
      registry.selectDecoderBackend(
        selectionOptions("utf-8", {
          backendPreference: ["text-decoder"],
        }),
      ),
    ).toThrow(EncodingError);

    try {
      registry.selectDecoderBackend(
        selectionOptions("utf-8", {
          backendPreference: ["text-decoder"],
        }),
      );
      throw new Error("Expected exact source map selection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
      expect((error as EncodingError).details).toMatchObject({
        encoding: "utf-8",
        profile: "rmem",
        sourceMap: "exact",
        exactSourceMapRequired: true,
        requestedBackends: ["text-decoder"],
        skippedBackends: [
          {
            backend: "text-decoder",
            reason: "exact-source-map-unavailable",
            exactSourceMap: false,
          },
        ],
      });
    }
  });

  it("rejects duplicate backend registrations deterministically", () => {
    const firstNative = createTestBackend({
      name: "native",
      exactSourceMap: true,
      supportedDecodings: ["utf-8"],
    });
    const secondNative = createTestBackend({
      name: "native",
      exactSourceMap: true,
      supportedDecodings: ["utf-16le"],
    });

    expect(() => new DecoderRegistry([firstNative, secondNative])).toThrow(EncodingError);
  });
});

function selectionOptions(
  encoding: RmemEncodingName,
  options?: DecodeDocumentOptions,
): SelectDecoderBackendOptions {
  const normalizedOptions = normalizeDecodeDocumentOptions(options);

  return {
    encoding,
    profile: normalizedOptions.profile,
    sourceMap: normalizedOptions.sourceMap,
    backendPreference: normalizedOptions.backendPreference,
  };
}

function createTestBackend(options: {
  readonly name: DecoderBackendName;
  readonly exactSourceMap: boolean;
  readonly supportedDecodings: readonly RmemEncodingName[];
}): DecoderBackend {
  const supportedDecodings = new Set(options.supportedDecodings);

  return {
    info: Object.freeze({
      name: options.name,
      exactSourceMap: options.exactSourceMap,
    }),
    canDecode(encoding) {
      return supportedDecodings.has(encoding);
    },
    canEncode() {
      return false;
    },
    decode() {
      return Object.freeze({
        text: "",
        warnings: Object.freeze([]),
      });
    },
    encode() {
      throw new Error("Encoding is not implemented by decoder registry tests.");
    },
  };
}
