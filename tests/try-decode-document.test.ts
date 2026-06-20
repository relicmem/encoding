import { describe, expect, expectTypeOf, it } from "vitest";

import { EncodingError, tryDecodeDocument } from "../src/index.js";
import type {
  DecodeDocumentOptions,
  RelicMEMEncodingName,
  TryDecodeDocumentFunction,
} from "../src/index.js";

describe("tryDecodeDocument", () => {
  it("exports the no-throw high-level decode pipeline with the public contract signature", () => {
    expectTypeOf(tryDecodeDocument).toEqualTypeOf<TryDecodeDocumentFunction>();
  });

  it("wraps successful decoded documents in an EncodingResult success branch", async () => {
    const result = await tryDecodeDocument("Привіт", {
      profile: "legacyCyrillic",
      sourceMap: "exact",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error("Expected successful decode result.");
    }

    expect(result.value.text).toBe("Привіт");
    expect(result.value.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("returns fatal EncodingError diagnostics without rejecting", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);
    const result = await tryDecodeDocument(bytes, {
      profile: "strictUtf8",
    });

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected failed decode result.");
    }

    expect(result.error).toBeInstanceOf(EncodingError);
    expect(result.error.code).toBe("ENCODING_INVALID_SEQUENCE");
    expect(result.error.message).toBe("Invalid UTF-8 continuation byte.");
    expect(result.error.byteRange).toEqual({ start: 0, end: 1 });
    expect(result.error.details).toMatchObject({
      encoding: "utf-8",
    });
    expect(result.error.warnings).toEqual([]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.error)).toBe(true);
  });

  it("keeps structured failure details from backend selection errors", async () => {
    const result = await tryDecodeDocument(new Uint8Array([0x41]), {
      backendPreference: ["text-decoder"],
    });

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected failed decode result.");
    }

    expect(result.error.code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
    expect(result.error.details).toMatchObject({
      encoding: "utf-8",
      requestedBackends: ["text-decoder"],
    });
    expect(Object.isFrozen(result.error.details)).toBe(true);
  });

  it("keeps an immutable options snapshot while collecting async iterable chunks", async () => {
    const allowedEncodings: RelicMEMEncodingName[] = ["utf-8"];
    const options: MutableDecodeDocumentOptions = {
      profile: "strictUtf8",
      allowedEncodings,
      replacementPolicy: "fatal",
    };
    const result = await tryDecodeDocument(
      createMutatingAsyncChunks(options, allowedEncodings),
      options,
    );

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected failed decode result.");
    }

    expect(result.error).toBeInstanceOf(EncodingError);
    expect(result.error.code).toBe("ENCODING_INVALID_SEQUENCE");
  });

  it("does not mask non-encoding failures from async input boundaries", async () => {
    const streamError = new Error("stream read failed");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(streamError);
      },
    });

    await expect(tryDecodeDocument(stream)).rejects.toBe(streamError);
  });
});

async function* createMutatingAsyncChunks(
  options: MutableDecodeDocumentOptions,
  allowedEncodings: RelicMEMEncodingName[],
): AsyncIterable<Uint8Array> {
  await Promise.resolve();

  options.profile = "legacyCyrillic";
  options.replacementPolicy = "replace";
  allowedEncodings.push("windows-1251");

  yield new Uint8Array([0xc3, 0x28]);
}

type MutableDecodeDocumentOptions = {
  -readonly [Key in keyof DecodeDocumentOptions]: DecodeDocumentOptions[Key];
};
