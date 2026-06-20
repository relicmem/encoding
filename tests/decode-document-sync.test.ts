import { describe, expect, expectTypeOf, it } from "vitest";

import { EncodingError, decodeDocumentSync } from "../src/index.js";
import type {
  DecodeDocumentOptions,
  DecodeDocumentSyncFunction,
  RmemEncodingName,
} from "../src/index.js";

describe("decodeDocumentSync", () => {
  it("exports the synchronous high-level decode pipeline with the public contract signature", () => {
    expectTypeOf(decodeDocumentSync).toEqualTypeOf<DecodeDocumentSyncFunction>();
  });

  it("decodes byte input into a complete immutable document with exact source ranges", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0a, 0xd0, 0x96]);
    const document = decodeDocumentSync(bytes);

    expect(document.text).toBe("#\nЖ");
    expect([...document.bytes]).toEqual([...bytes]);
    expect([...document.source.bytes]).toEqual([...bytes]);
    expect(document.detection).toMatchObject({
      encoding: "utf-8",
      source: "bom",
      bomLength: 3,
      backend: {
        name: "native",
        version: "native-v1",
        exactSourceMap: true,
      },
    });
    expect(document.warnings).toEqual([]);
    expect(document.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 3 },
        textRange: { start: 0, end: 0 },
        kind: "bom",
      },
      {
        byteRange: { start: 3, end: 5 },
        textRange: { start: 0, end: 2 },
        kind: "identity",
      },
      {
        byteRange: { start: 5, end: 7 },
        textRange: { start: 2, end: 3 },
        kind: "encoded",
      },
    ]);
    expect(document.lineIndex.lineByteRange(1, true)).toEqual({ start: 3, end: 5 });
    expect(document.lineIndex.lineByteRange(2)).toEqual({ start: 5, end: 7 });
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.warnings)).toBe(true);

    const mutableRead = document.bytes;
    mutableRead[0] = 0x00;
    expect([...document.bytes]).toEqual([...bytes]);

    const bufferDocument = decodeDocumentSync(new Uint8Array(bytes).buffer);
    const iterableDocument = decodeDocumentSync([bytes.subarray(0, 3), bytes.subarray(3)]);

    expect(bufferDocument.text).toBe(document.text);
    expect(iterableDocument.text).toBe(document.text);
    expect(iterableDocument.offsetMap.segments()).toEqual(document.offsetMap.segments());
  });

  it("keeps string input on the synthetic byte path after normalizing decode options", () => {
    const document = decodeDocumentSync("Привіт", {
      profile: "legacyCyrillic",
      sourceMap: "exact",
    });

    expect(document.text).toBe("Привіт");
    expect(document.detection).toMatchObject({
      encoding: "windows-1251",
      source: "explicit",
      backend: {
        name: "native",
        exactSourceMap: true,
      },
    });
    expect(document.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
    ]);
    expect(document.offsetMap.segments().every((segment) => segment.kind === "synthetic")).toBe(
      true,
    );
  });

  it("keeps an immutable options snapshot while collecting sync iterable chunks", () => {
    const allowedEncodings: RmemEncodingName[] = ["utf-8"];
    const options: MutableDecodeDocumentOptions = {
      profile: "strictUtf8",
      allowedEncodings,
      replacementPolicy: "fatal",
    };
    const chunks: Iterable<Uint8Array> = {
      *[Symbol.iterator]() {
        options.profile = "legacyCyrillic";
        options.replacementPolicy = "replace";
        allowedEncodings.push("windows-1251");

        yield invalidUtf8Bytes();
      },
    };

    try {
      decodeDocumentSync(chunks, options);
      throw new Error("Expected strict UTF-8 detection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
    }
  });

  it("merges detection, backend-selection and decoder warnings in stable order", () => {
    const document = decodeDocumentSync(new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28]), {
      profile: "webCompat",
      metadata: {
        declaredEncoding: "windows-1251",
      },
      replacementPolicy: "replace",
      backendPreference: ["text-decoder", "native"],
    });

    expect(document.text).toBe("\uFFFD(");
    expect(document.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_BOM_CONFLICT",
      "ENCODING_BACKEND_SUBSTITUTION",
      "ENCODING_INVALID_SEQUENCE_REPLACED",
    ]);
    expect(document.detection.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_BOM_CONFLICT",
    ]);
    expect(document.detection.backend).toMatchObject({
      name: "native",
      exactSourceMap: true,
    });
  });

  it("supports sourceMap none by allowing a non-exact backend and exposing a coarse map", () => {
    const document = decodeDocumentSync(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x0a, 0x42]), {
      sourceMap: "none",
      backendPreference: ["text-decoder", "native"],
    });

    expect(document.text).toBe("A\nB");
    expect(document.detection.backend).toMatchObject({
      name: "text-decoder",
      exactSourceMap: false,
    });
    expect(document.warnings).toEqual([]);
    expect(document.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 6 },
        textRange: { start: 0, end: 3 },
        kind: "encoded",
      },
    ]);
    expect(document.lineIndex.lineCount).toBe(2);
    expect(document.lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 2 });
  });

  it("surfaces fatal detection, backend and input boundary failures without async support", () => {
    expect(() =>
      decodeDocumentSync(new Uint8Array([0xc3, 0x28]), {
        profile: "strictUtf8",
      }),
    ).toThrow(EncodingError);

    try {
      decodeDocumentSync(new Uint8Array([0x41]), {
        backendPreference: ["text-decoder"],
      });
      throw new Error("Expected source map backend selection failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
    }

    const asyncOnlyInput = (async function* () {
      await Promise.resolve();
      yield new Uint8Array([0x41]);
    })();

    expect(() => decodeDocumentSync(asyncOnlyInput as never)).toThrow(TypeError);
  });
});

type MutableDecodeDocumentOptions = {
  -readonly [Key in keyof DecodeDocumentOptions]: DecodeDocumentOptions[Key];
};

function invalidUtf8Bytes(): Uint8Array {
  return new Uint8Array([0xc3, 0x28]);
}
