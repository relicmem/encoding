import { describe, expect, it } from "vitest";

import { EncodingError, detectEncoding } from "../src/index.js";
import type { DecodeDocumentOptions, RelicMEMEncodingName } from "../src/index.js";
import { createDetectionSampler } from "../src/stream/DetectionSampler.js";

describe("DetectionSampler", () => {
  it("collects a bounded sample without losing original buffered chunk boundaries", () => {
    const first = new Uint8Array([0x61, 0x62]);
    const second = new Uint8Array();
    const third = new Uint8Array([0x63, 0x64, 0x65]);
    const sampler = createDetectionSampler({ sampleSizeBytes: 4 });

    expect(sampler.write(first)).toMatchObject({
      samplingComplete: false,
      sampledByteLength: 2,
      bufferedByteLength: 2,
    });
    expect(sampler.write(second)).toMatchObject({
      samplingComplete: false,
      sampledByteLength: 2,
      bufferedByteLength: 2,
    });
    const finalWrite = sampler.write(third);

    first[0] = 0x7a;
    third[0] = 0x7a;

    expect(finalWrite).toMatchObject({
      samplingComplete: true,
      sampledByteLength: 4,
      bufferedByteLength: 5,
      detection: {
        encoding: "utf-8",
        source: "utf8-validation",
      },
    });
    expect(sampler.chunks()).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        bytes: new Uint8Array([0x61, 0x62]),
      },
      {
        byteRange: { start: 2, end: 2 },
        bytes: new Uint8Array(),
      },
      {
        byteRange: { start: 2, end: 5 },
        bytes: new Uint8Array([0x63, 0x64, 0x65]),
      },
    ]);
    expect(sampler.sample()).toMatchObject({
      sampledByteLength: 4,
      bufferedByteLength: 5,
      truncated: true,
      chunks: [
        {
          byteRange: { start: 0, end: 2 },
          bytes: new Uint8Array([0x61, 0x62]),
        },
        {
          byteRange: { start: 2, end: 2 },
          bytes: new Uint8Array(),
        },
        {
          byteRange: { start: 2, end: 4 },
          bytes: new Uint8Array([0x63, 0x64]),
        },
      ],
    });
    expect([...sampler.sample().bytes]).toEqual([0x61, 0x62, 0x63, 0x64]);
  });

  it("waits for split BOM bytes before fixing explicit or metadata-backed detection", () => {
    const sampler = createDetectionSampler({
      explicitEncoding: "windows-1251",
      sampleSizeBytes: 64,
    });

    expect(sampler.write(new Uint8Array([0xef])).samplingComplete).toBe(false);
    expect(sampler.write(new Uint8Array([0xbb])).samplingComplete).toBe(false);

    const result = sampler.write(new Uint8Array([0xbf, 0x41]));

    expect(result.samplingComplete).toBe(true);
    expect(result.detection).toMatchObject({
      encoding: "windows-1251",
      source: "explicit",
      bomLength: 3,
    });
    expect(result.detection?.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_BOM_CONFLICT",
    ]);
    expect(sampler.chunks().map((chunk) => chunk.byteRange)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("fixes BOM detection as soon as a complete UTF-16 BOM is available", () => {
    const sampler = createDetectionSampler({ sampleSizeBytes: 64 });

    expect(sampler.write(new Uint8Array([0xff])).samplingComplete).toBe(false);

    const result = sampler.write(new Uint8Array([0xfe]));

    expect(result).toMatchObject({
      samplingComplete: true,
      sampledByteLength: 2,
      bufferedByteLength: 2,
      detection: {
        encoding: "utf-16le",
        source: "bom",
        bomLength: 2,
      },
    });
  });

  it("recognizes a complete BOM even when the triggering chunk contains following bytes", () => {
    const sampler = createDetectionSampler({ sampleSizeBytes: 64 });
    const result = sampler.write(new Uint8Array([0xff, 0xfe, 0x23, 0x00]));

    expect(result).toMatchObject({
      samplingComplete: true,
      sampledByteLength: 4,
      bufferedByteLength: 4,
      detection: {
        encoding: "utf-16le",
        source: "bom",
        bomLength: 2,
      },
    });
  });

  it("finalizes detection from the buffered sample when the stream ends below the sample limit", () => {
    const sampler = createDetectionSampler({ profile: "legacyCyrillic", sampleSizeBytes: 64 });
    const first = new Uint8Array([0xcf, 0xf0]);
    const second = new Uint8Array([0xe8, 0xe2, 0xe5, 0xf2]);

    sampler.write(first);
    sampler.write(second);

    const finished = sampler.finish();
    const expectedDetection = detectEncoding(new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]), {
      profile: "legacyCyrillic",
      sampleSizeBytes: 64,
    });

    expect(finished.detection).toEqual(expectedDetection);
    expect(finished.sample).toMatchObject({
      sampledByteLength: 6,
      bufferedByteLength: 6,
      truncated: false,
    });
    expect(finished.chunks.map((chunk) => chunk.byteRange)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 6 },
    ]);
    expect(() => sampler.write(new Uint8Array([0x21]))).toThrow(RangeError);
  });

  it("keeps an immutable options snapshot after sampler construction", () => {
    const allowedEncodings: RelicMEMEncodingName[] = ["utf-8"];
    const options: MutableDecodeDocumentOptions = {
      profile: "strictUtf8",
      allowedEncodings,
      replacementPolicy: "fatal",
      sampleSizeBytes: 2,
    };
    const sampler = createDetectionSampler(options);

    options.profile = "legacyCyrillic";
    options.replacementPolicy = "replace";
    allowedEncodings.push("windows-1251");

    expect(() => sampler.write(new Uint8Array([0xc3, 0x28]))).toThrow(EncodingError);
  });

  it("returns defensive snapshots for buffered chunks and samples", () => {
    const sampler = createDetectionSampler({ sampleSizeBytes: 1 });

    sampler.write(new Uint8Array([0x41, 0x42]));

    const firstChunk = sampler.chunks()[0];
    const firstSampleChunk = sampler.sample().chunks[0];

    if (firstChunk === undefined || firstSampleChunk === undefined) {
      throw new Error("Expected sampler snapshots to contain chunks.");
    }

    firstChunk.bytes[0] = 0x7a;
    firstSampleChunk.bytes[0] = 0x7a;

    expect([...(sampler.chunks()[0]?.bytes ?? [])]).toEqual([0x41, 0x42]);
    expect([...(sampler.sample().chunks[0]?.bytes ?? [])]).toEqual([0x41]);
    expect(Object.isFrozen(sampler.sample().chunks)).toBe(true);
  });
});

type MutableDecodeDocumentOptions = {
  -readonly [Key in keyof DecodeDocumentOptions]: DecodeDocumentOptions[Key];
};
