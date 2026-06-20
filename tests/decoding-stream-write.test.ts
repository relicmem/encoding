import { describe, expect, expectTypeOf, it } from "vitest";

import { EncodingError, createDecodingStream } from "../src/index.js";
import type { CreateDecodingStreamFunction, DecodedChunk } from "../src/index.js";

describe("DecodingStream.write", () => {
  it("exports the stream factory with the public contract signature", () => {
    expectTypeOf(createDecodingStream).toEqualTypeOf<CreateDecodingStreamFunction>();
  });

  it("buffers writes until detection is fixed and then keeps stable accumulated ranges", () => {
    const stream = createDecodingStream({ sampleSizeBytes: 4 });
    const first = new Uint8Array([0x41, 0x42]);
    const second = new Uint8Array([0x43, 0x44]);

    expect(stream.detection).toBeUndefined();
    expect(stream.write(first)).toEqual([]);

    const initialFlush = stream.write(second);
    first[0] = 0x7a;
    second[0] = 0x7a;

    const bufferedChunk = onlyChunk(initialFlush);
    expect(bufferedChunk.text).toBe("ABCD");
    expect(bufferedChunk.byteRange).toEqual({ start: 0, end: 4 });
    expect(bufferedChunk.charRange).toEqual({ start: 0, end: 4 });
    expect(bufferedChunk.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 4 },
        textRange: { start: 0, end: 4 },
        kind: "identity",
      },
    ]);
    expect(stream.detection).toMatchObject({
      encoding: "utf-8",
      source: "utf8-validation",
      backend: {
        name: "native",
        exactSourceMap: true,
      },
    });

    const nextChunk = onlyChunk(stream.write(new Uint8Array([0xd0, 0x96, 0x21])));

    expect(nextChunk.text).toBe("Ж!");
    expect(nextChunk.byteRange).toEqual({ start: 4, end: 7 });
    expect(nextChunk.charRange).toEqual({ start: 4, end: 6 });
    expect(nextChunk.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 1 },
        kind: "encoded",
      },
      {
        byteRange: { start: 2, end: 3 },
        textRange: { start: 1, end: 2 },
        kind: "identity",
      },
    ]);
    expect(nextChunk.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 0,
      end: 2,
    });
    expect(Object.isFrozen(initialFlush)).toBe(true);
    expect(Object.isFrozen(bufferedChunk)).toBe(true);
    expect(Object.isFrozen(bufferedChunk.warnings)).toBe(true);
  });

  it("decodes the first buffered window as one chunk so split BOM bytes are not decoded early", () => {
    const stream = createDecodingStream({ sampleSizeBytes: 64 });

    expect(stream.write(new Uint8Array([0xef]))).toEqual([]);
    expect(stream.detection).toBeUndefined();

    const chunk = onlyChunk(stream.write(new Uint8Array([0xbb, 0xbf, 0x41])));

    expect(stream.detection).toMatchObject({
      encoding: "utf-8",
      source: "bom",
      bomLength: 3,
    });
    expect(chunk.text).toBe("A");
    expect(chunk.byteRange).toEqual({ start: 0, end: 4 });
    expect(chunk.charRange).toEqual({ start: 0, end: 1 });
    expect(chunk.offsetMap.segments()).toEqual([
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
    ]);
  });

  it("returns decoder warnings with stream-global byte and text ranges", () => {
    const stream = createDecodingStream({
      explicitEncoding: "utf-8",
      replacementPolicy: "replace",
      sampleSizeBytes: 64,
    });

    expect(onlyChunk(stream.write(new Uint8Array([0x41]))).text).toBe("A");

    const chunk = onlyChunk(stream.write(new Uint8Array([0xc3, 0x28])));

    expect(chunk.text).toBe("\uFFFD(");
    expect(chunk.byteRange).toEqual({ start: 1, end: 3 });
    expect(chunk.charRange).toEqual({ start: 1, end: 3 });
    expect(chunk.warnings).toHaveLength(1);
    expect(chunk.warnings[0]).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE_REPLACED",
      byteRange: { start: 1, end: 2 },
      textRange: { start: 1, end: 2 },
      details: {
        backend: "native",
        encoding: "utf-8",
      },
    });
  });

  it("emits backend selection warnings once on the first decoded chunk", () => {
    const stream = createDecodingStream({
      backendPreference: ["text-decoder", "native"],
      sampleSizeBytes: 1,
    });

    const firstChunk = onlyChunk(stream.write(new Uint8Array([0x41])));
    const secondChunk = onlyChunk(stream.write(new Uint8Array([0x42])));

    expect(firstChunk.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_BACKEND_SUBSTITUTION",
    ]);
    expect(firstChunk.warnings[0]?.details).toMatchObject({
      requestedBackend: "text-decoder",
      selectedBackend: "native",
      reason: "exact-source-map-unavailable",
    });
    expect(secondChunk.warnings).toEqual([]);
  });

  it("preserves sample-limited detection warnings on fatal post-detection write errors", () => {
    const stream = createDecodingStream({
      profile: "strictUtf8",
      sampleSizeBytes: 1,
    });

    expect(stream.write(new Uint8Array([0x41]))).toHaveLength(1);

    try {
      stream.write(new Uint8Array([0xc3, 0x28]));
      throw new Error("Expected post-detection stream write to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
      expect(warningCodes((error as EncodingError).warnings)).toEqual([
        "ENCODING_TRUNCATED_SAMPLE",
        "ENCODING_LOW_CONFIDENCE",
      ]);
      expect((error as EncodingError).warnings[0]).toMatchObject({
        details: {
          sampledByteLength: 1,
          originalByteLength: 3,
          inputComplete: false,
          confidenceCap: 0.99,
        },
      });
    }
  });
});

function onlyChunk(chunks: readonly DecodedChunk[]): DecodedChunk {
  expect(chunks).toHaveLength(1);

  const chunk = chunks[0];
  if (chunk === undefined) {
    throw new Error("Expected one decoded chunk.");
  }

  return chunk;
}

function warningCodes(warnings: readonly { readonly code: string }[]): readonly string[] {
  return warnings.map((warning) => warning.code);
}
