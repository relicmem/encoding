import { describe, expect, it } from "vitest";

import {
  normalizeEncodingInput,
  normalizeEncodingInputSync,
  type NormalizedByteInput,
  type NormalizedEncodingInput,
} from "../src/index.js";
import type { SyncEncodingInput } from "../src/index.js";

describe("input normalization", () => {
  it("normalizes Uint8Array and ArrayBuffer inputs without sharing mutable bytes", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);
    const fromBytes = expectByteInput(normalizeEncodingInputSync(bytes));

    bytes.fill(0);

    expect(fromBytes.inputKind).toBe("uint8array");
    expect(fromBytes.byteLength).toBe(4);
    expect([...fromBytes.source.bytes]).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect(fromBytes.chunks()).toEqual([
      {
        byteRange: { start: 0, end: 4 },
        bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x41]),
      },
    ]);

    const buffer = new ArrayBuffer(3);
    const view = new Uint8Array(buffer);
    view.set([0x61, 0x62, 0x63]);
    const fromBuffer = expectByteInput(normalizeEncodingInputSync(buffer));

    view[0] = 0x7a;

    expect(fromBuffer.inputKind).toBe("arraybuffer");
    expect([...fromBuffer.source.bytes]).toEqual([0x61, 0x62, 0x63]);
  });

  it("preserves iterable chunk boundaries and builds bounded byte samples without decoding", () => {
    const first = new Uint8Array([0x61, 0x62]);
    const second = new Uint8Array();
    const third = new Uint8Array([0x63, 0x64, 0x65]);
    const input = expectByteInput(normalizeEncodingInputSync([first, second, third]));

    first[0] = 0x7a;
    third[0] = 0x7a;

    expect(input.inputKind).toBe("iterable");
    expect([...input.source.bytes]).toEqual([0x61, 0x62, 0x63, 0x64, 0x65]);
    expect(input.chunks()).toEqual([
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

    const sample = input.sample(4);

    expect([...sample.bytes]).toEqual([0x61, 0x62, 0x63, 0x64]);
    expect(sample).toMatchObject({
      sampledByteLength: 4,
      originalByteLength: 5,
      truncated: true,
    });
    expect(sample.chunks).toEqual([
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
    ]);
  });

  it("normalizes async iterables and ReadableStream inputs with the same byte representation", async () => {
    const asyncInput = expectByteInput(
      await normalizeEncodingInput(createAsyncChunks([0x41], [0x42, 0x43])),
    );

    expect(asyncInput.inputKind).toBe("async-iterable");
    expect([...asyncInput.source.bytes]).toEqual([0x41, 0x42, 0x43]);
    expect(asyncInput.chunks().map((chunk) => chunk.byteRange)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ]);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x41]));
        controller.enqueue(new Uint8Array([0x42, 0x43]));
        controller.close();
      },
    });
    const streamInput = expectByteInput(await normalizeEncodingInput(stream));

    expect(streamInput.inputKind).toBe("readable-stream");
    expect([...streamInput.source.bytes]).toEqual([...asyncInput.source.bytes]);
    expect(streamInput.chunks()).toEqual(asyncInput.chunks());
  });

  it("keeps string inputs separate from byte normalization", async () => {
    const syncInput = normalizeEncodingInputSync("Документ");
    const asyncInput = await normalizeEncodingInput("Документ");

    expect(syncInput).toEqual({
      kind: "string",
      inputKind: "string",
      text: "Документ",
    });
    expect(asyncInput).toEqual(syncInput);
  });

  it("rejects async-only inputs in sync normalization", () => {
    const asyncOnlyInput = createAsyncChunks([0x61]) as unknown as SyncEncodingInput;
    const streamInput = new ReadableStream<Uint8Array>() as unknown as SyncEncodingInput;

    expect(() => normalizeEncodingInputSync(asyncOnlyInput)).toThrow(TypeError);
    expect(() => normalizeEncodingInputSync(streamInput)).toThrow(TypeError);
  });

  it("rejects invalid chunk types and chunkless iterable inputs", async () => {
    const invalidSyncChunks = [new Uint16Array([0x61])] as unknown as Iterable<Uint8Array>;

    expect(() => normalizeEncodingInputSync(invalidSyncChunks)).toThrow(TypeError);
    expect(() => normalizeEncodingInputSync([])).toThrow(RangeError);
    expect(() => expectByteInput(normalizeEncodingInputSync(new Uint8Array())).sample(0)).toThrow(
      RangeError,
    );

    await expect(normalizeEncodingInput(createInvalidAsyncChunks())).rejects.toThrow(TypeError);
    await expect(normalizeEncodingInput(createAsyncChunks())).rejects.toThrow(RangeError);
  });

  it("returns defensive chunk and sample copies", () => {
    const input = expectByteInput(normalizeEncodingInputSync([new Uint8Array([0x61, 0x62])]));
    const chunks = input.chunks();
    const firstChunk = chunks[0];

    if (firstChunk === undefined) {
      throw new Error("Expected normalized input to contain a chunk.");
    }

    firstChunk.bytes[0] = 0x7a;

    expect([...(input.chunks()[0]?.bytes ?? [])]).toEqual([0x61, 0x62]);

    const sample = input.sample(1);
    const sampledChunk = sample.chunks[0];

    if (sampledChunk === undefined) {
      throw new Error("Expected normalized sample to contain a chunk.");
    }

    sampledChunk.bytes[0] = 0x7a;

    expect([...input.sample(1).bytes]).toEqual([0x61]);
  });
});

function expectByteInput(input: NormalizedEncodingInput): NormalizedByteInput {
  expect(input.kind).toBe("bytes");

  if (input.kind !== "bytes") {
    throw new Error("Expected normalized byte input.");
  }

  return input;
}

async function* createAsyncChunks(...chunks: readonly number[][]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield new Uint8Array(chunk);
  }
}

async function* createInvalidAsyncChunks(): AsyncIterable<Uint8Array> {
  await Promise.resolve();
  yield new Uint16Array([0x61]) as unknown as Uint8Array;
}
