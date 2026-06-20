import { describe, expect, it } from "vitest";

import { EncodingError, createDecodingStream, decodeDocumentSync } from "../src/index.js";

describe("DecodingStream.end", () => {
  it("finalizes detection below the sample limit and returns a complete document", () => {
    const stream = createDecodingStream({ sampleSizeBytes: 64 });
    const chunk = new Uint8Array([0x41, 0x42]);

    expect(stream.write(chunk)).toEqual([]);
    expect(stream.detection).toBeUndefined();

    chunk[0] = 0x7a;
    const document = stream.end();

    expect(document.text).toBe("AB");
    expect([...document.bytes]).toEqual([0x41, 0x42]);
    expect(document.source.slice()).toEqual(new Uint8Array([0x41, 0x42]));
    expect(document.detection).toMatchObject({
      encoding: "utf-8",
      source: "utf8-validation",
      backend: {
        name: "native",
        exactSourceMap: true,
      },
    });
    expect(document.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 2 },
        kind: "identity",
      },
    ]);
    expect(document.lineIndex.lineCount).toBe(1);
    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.warnings)).toBe(true);
  });

  it("returns a document consistent with decodeDocumentSync for the same byte sequence", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a, 0xd0, 0x96, 0x21]);
    const options = { sampleSizeBytes: bytes.byteLength };
    const expected = decodeDocumentSync(bytes, options);
    const stream = createDecodingStream(options);

    expect(stream.write(bytes.subarray(0, 1))).toEqual([]);
    stream.write(bytes.subarray(1, 5));
    stream.write(bytes.subarray(5, 7));
    stream.write(bytes.subarray(7));

    const document = stream.end();

    expect(document.text).toBe(expected.text);
    expect([...document.bytes]).toEqual([...expected.bytes]);
    expect(document.detection).toMatchObject({
      encoding: expected.detection.encoding,
      source: expected.detection.source,
      bomLength: expected.detection.bomLength,
      backend: expected.detection.backend,
    });
    expect(document.warnings).toEqual(expected.warnings);
    expect(document.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual(
      expected.offsetMap.byteRangeForTextRange({ start: 0, end: 1 }),
    );
    expect(document.offsetMap.byteRangeForTextRange({ start: 3, end: 4 })).toEqual(
      expected.offsetMap.byteRangeForTextRange({ start: 3, end: 4 }),
    );
    expect(document.lineIndex.lineCount).toBe(expected.lineIndex.lineCount);
    expect(document.lineIndex.lineTextRange(1, true)).toEqual(
      expected.lineIndex.lineTextRange(1, true),
    );
    expect(document.lineIndex.lineByteRange(2)).toEqual(expected.lineIndex.lineByteRange(2));
  });

  it("keeps backend selection warnings when end creates an empty document", () => {
    const options = {
      backendPreference: ["text-decoder", "native"],
    } as const;
    const expected = decodeDocumentSync(new Uint8Array(), options);
    const stream = createDecodingStream(options);

    const document = stream.end();

    expect(document.text).toBe("");
    expect(document.warnings).toEqual(expected.warnings);
    expect(warningCodes(document.warnings)).toContain("ENCODING_BACKEND_SUBSTITUTION");
  });

  it("keeps backend selection warnings when delayed detection is finalized in end", () => {
    const bytes = new Uint8Array([0x41, 0x42]);
    const options = {
      backendPreference: ["text-decoder", "native"],
      sampleSizeBytes: 64,
    } as const;
    const expected = decodeDocumentSync(bytes, options);
    const stream = createDecodingStream(options);

    expect(stream.write(bytes)).toEqual([]);

    const document = stream.end();

    expect(document.text).toBe("AB");
    expect(document.warnings).toEqual(expected.warnings);
    expect(warningCodes(document.warnings)).toEqual(warningCodes(expected.warnings));
  });

  it("does not duplicate backend warnings consumed by the first decoded chunk", () => {
    const stream = createDecodingStream({
      backendPreference: ["text-decoder", "native"],
      sampleSizeBytes: 1,
    });

    const firstChunk = stream.write(new Uint8Array([0x41]));
    const document = stream.end();

    expect(warningCodes(firstChunk.flatMap((chunk) => chunk.warnings))).toEqual([
      "ENCODING_BACKEND_SUBSTITUTION",
    ]);
    expect(warningCodes(document.warnings)).toEqual(["ENCODING_BACKEND_SUBSTITUTION"]);
  });

  it("keeps sample-limited detection warnings when later bytes extend beyond the stream sample", () => {
    const stream = createDecodingStream({
      profile: "strictUtf8",
      replacementPolicy: "replace",
      sampleSizeBytes: 1,
    });

    const firstChunk = stream.write(new Uint8Array([0x41]));

    expect(firstChunk).toHaveLength(1);
    expect(stream.detection).toMatchObject({
      encoding: "utf-8",
      confidence: 0.99,
      source: "utf8-validation",
    });
    expect(warningCodes(requiredDetection(stream.detection).warnings)).toEqual([
      "ENCODING_TRUNCATED_SAMPLE",
      "ENCODING_LOW_CONFIDENCE",
    ]);

    stream.write(new Uint8Array([0xc3, 0x28]));
    const document = stream.end();

    expect(document.text).toBe("A\uFFFD(");
    expect(document.detection).toMatchObject({
      encoding: "utf-8",
      confidence: 0.99,
      source: "utf8-validation",
    });
    expect(warningCodes(document.detection.warnings)).toEqual([
      "ENCODING_TRUNCATED_SAMPLE",
      "ENCODING_LOW_CONFIDENCE",
    ]);
    expect(document.detection.warnings[0]).toMatchObject({
      details: {
        sampledByteLength: 1,
        originalByteLength: 3,
        inputComplete: true,
        confidenceCap: 0.99,
      },
    });
    expect(warningCodes(document.warnings)).toEqual([
      "ENCODING_TRUNCATED_SAMPLE",
      "ENCODING_LOW_CONFIDENCE",
      "ENCODING_INVALID_SEQUENCE_REPLACED",
    ]);
  });

  it("treats CRLF split across chunks as one final line break", () => {
    const stream = createDecodingStream({
      explicitEncoding: "utf-8",
      sampleSizeBytes: 1,
    });

    stream.write(new Uint8Array([0x41, 0x0d]));
    stream.write(new Uint8Array([0x0a, 0x42]));

    const document = stream.end();

    expect(document.text).toBe("A\r\nB");
    expect(document.lineIndex.lineCount).toBe(2);
    expect(document.lineIndex.lineTextRange(1)).toEqual({ start: 0, end: 1 });
    expect(document.lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(document.lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(document.lineIndex.positionAtTextOffset(3)).toMatchObject({
      line: 2,
      column: 1,
      characterOffset: 3,
      byteOffset: 3,
    });
  });

  it("rejects writes after a successful end", () => {
    const stream = createDecodingStream({ sampleSizeBytes: 1 });

    stream.write(new Uint8Array([0x41]));
    stream.end();

    expect(() => stream.write(new Uint8Array([0x42]))).toThrow(
      "Decoding stream cannot accept input after end.",
    );
  });

  it("does not return a partial document after a fatal finalization error", () => {
    const stream = createDecodingStream({
      explicitEncoding: "utf-8",
      sampleSizeBytes: 1,
    });

    expect(stream.write(new Uint8Array([0x41]))).toHaveLength(1);
    expect(stream.write(new Uint8Array([0xe2, 0x82]))).toEqual([]);

    try {
      stream.end();
      throw new Error("Expected stream finalization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INCOMPLETE_STREAM_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 3 });
    }
  });

  it("preserves backend warnings on fatal stream finalization errors", () => {
    const stream = createDecodingStream({
      backendPreference: ["text-decoder", "native"],
      explicitEncoding: "utf-8",
      sampleSizeBytes: 1,
    });

    const firstChunk = stream.write(new Uint8Array([0x41]));
    expect(warningCodes(firstChunk.flatMap((chunk) => chunk.warnings))).toEqual([
      "ENCODING_BACKEND_SUBSTITUTION",
    ]);
    expect(stream.write(new Uint8Array([0xe2, 0x82]))).toEqual([]);

    try {
      stream.end();
      throw new Error("Expected stream finalization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INCOMPLETE_STREAM_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 3 });
      expect(warningCodes((error as EncodingError).warnings)).toEqual([
        "ENCODING_BACKEND_SUBSTITUTION",
      ]);
    }
  });
});

function warningCodes(warnings: readonly { readonly code: string }[]): readonly string[] {
  return warnings.map((warning) => warning.code);
}

function requiredDetection<TDetection>(detection: TDetection | undefined): TDetection {
  if (detection === undefined) {
    throw new Error("Expected stream detection.");
  }

  return detection;
}
