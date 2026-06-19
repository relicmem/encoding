import type { EncodingInput, SyncEncodingInput } from "../contracts/encoding.js";
import type { SourceBuffer as SourceBufferContract, SourceByteRange } from "../contracts/source.js";
import { createSourceBufferFromChunks } from "./SourceBuffer.js";

export type NormalizedInputKind = "bytes" | "string";

export type NormalizedByteInputKind =
  | "uint8array"
  | "arraybuffer"
  | "iterable"
  | "async-iterable"
  | "readable-stream";

export type NormalizedInputSourceKind = "string" | NormalizedByteInputKind;

export type NormalizedEncodingInput = NormalizedByteInput | NormalizedStringInput;

export interface NormalizedInputChunk {
  readonly byteRange: SourceByteRange;
  readonly bytes: Uint8Array;
}

export interface NormalizedInputSample {
  readonly bytes: Uint8Array;
  readonly chunks: readonly NormalizedInputChunk[];
  readonly sampledByteLength: number;
  readonly originalByteLength: number;
  readonly truncated: boolean;
}

export interface NormalizedStringInput {
  readonly kind: "string";
  readonly inputKind: "string";
  readonly text: string;
}

export interface NormalizedByteInput {
  readonly kind: "bytes";
  readonly inputKind: NormalizedByteInputKind;
  readonly byteLength: number;
  readonly source: SourceBufferContract;
  chunks(): readonly NormalizedInputChunk[];
  sample(sampleSizeBytes: number): NormalizedInputSample;
}

interface OwnedInputChunk {
  readonly byteRange: SourceByteRange;
  readonly bytes: Uint8Array;
}

interface CollectedByteChunks {
  readonly byteLength: number;
  readonly chunks: readonly OwnedInputChunk[];
}

export async function normalizeEncodingInput(
  input: EncodingInput,
): Promise<NormalizedEncodingInput> {
  if (typeof input === "string") {
    return createNormalizedStringInput(input);
  }

  if (input instanceof Uint8Array) {
    return createNormalizedByteInput("uint8array", [input]);
  }

  if (input instanceof ArrayBuffer) {
    return createNormalizedByteInput("arraybuffer", [new Uint8Array(input)]);
  }

  if (isReadableStreamInput(input)) {
    return createNormalizedByteInputFromReadableStream(input);
  }

  if (isAsyncIterableInput(input)) {
    return createNormalizedByteInputFromAsyncIterable(input);
  }

  if (isIterableInput(input)) {
    return createNormalizedByteInput("iterable", input);
  }

  throw invalidEncodingInputError(input);
}

export function normalizeEncodingInputSync(input: SyncEncodingInput): NormalizedEncodingInput {
  if (typeof input === "string") {
    return createNormalizedStringInput(input);
  }

  if (input instanceof Uint8Array) {
    return createNormalizedByteInput("uint8array", [input]);
  }

  if (input instanceof ArrayBuffer) {
    return createNormalizedByteInput("arraybuffer", [new Uint8Array(input)]);
  }

  if (isIterableInput(input)) {
    return createNormalizedByteInput("iterable", input);
  }

  if (isReadableStreamInput(input) || isAsyncIterableInput(input)) {
    throw new TypeError("Synchronous input normalization does not accept async-only inputs.");
  }

  throw invalidEncodingInputError(input);
}

function createNormalizedStringInput(text: string): NormalizedStringInput {
  return Object.freeze({
    kind: "string",
    inputKind: "string",
    text,
  });
}

function createNormalizedByteInput(
  inputKind: NormalizedByteInputKind,
  chunks: Iterable<Uint8Array>,
): NormalizedByteInput {
  const collector = new ByteChunkCollector(inputKind);

  for (const chunk of chunks) {
    collector.add(chunk);
  }

  return new ImmutableNormalizedByteInput(inputKind, collector.finish());
}

async function createNormalizedByteInputFromAsyncIterable(
  chunks: AsyncIterable<Uint8Array>,
): Promise<NormalizedByteInput> {
  const collector = new ByteChunkCollector("async-iterable");

  for await (const chunk of chunks) {
    collector.add(chunk);
  }

  return new ImmutableNormalizedByteInput("async-iterable", collector.finish());
}

async function createNormalizedByteInputFromReadableStream(
  stream: ReadableStream<Uint8Array>,
): Promise<NormalizedByteInput> {
  const reader = stream.getReader();
  const collector = new ByteChunkCollector("readable-stream");

  try {
    for (;;) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      collector.add(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return new ImmutableNormalizedByteInput("readable-stream", collector.finish());
}

class ImmutableNormalizedByteInput implements NormalizedByteInput {
  readonly kind = "bytes" as const;
  readonly inputKind: NormalizedByteInputKind;
  readonly byteLength: number;
  readonly source: SourceBufferContract;
  private readonly chunkStorage: readonly OwnedInputChunk[];

  constructor(inputKind: NormalizedByteInputKind, collected: CollectedByteChunks) {
    this.inputKind = inputKind;
    this.byteLength = collected.byteLength;
    this.chunkStorage = collected.chunks;
    this.source = createSourceBufferFromChunks(collected.chunks.map((chunk) => chunk.bytes));

    Object.freeze(this);
  }

  chunks(): readonly NormalizedInputChunk[] {
    return freezeInputChunkCopies(this.chunkStorage);
  }

  sample(sampleSizeBytes: number): NormalizedInputSample {
    return createInputSample(this.chunkStorage, this.byteLength, sampleSizeBytes);
  }
}

class ByteChunkCollector {
  private byteLengthValue = 0;
  private readonly chunksValue: OwnedInputChunk[] = [];
  private readonly inputKind: NormalizedByteInputKind;

  constructor(inputKind: NormalizedByteInputKind) {
    this.inputKind = inputKind;
  }

  add(chunk: unknown): void {
    assertChunkIsUint8Array(chunk, this.inputKind);
    assertCanAppendBytes(this.byteLengthValue, chunk.byteLength, this.inputKind);

    const ownedChunk = createOwnedInputChunk(chunk, {
      start: this.byteLengthValue,
      end: this.byteLengthValue + chunk.byteLength,
    });

    this.chunksValue.push(ownedChunk);
    this.byteLengthValue += chunk.byteLength;
  }

  finish(): CollectedByteChunks {
    if (this.chunksValue.length === 0) {
      throw new RangeError("Encoding byte input must contain at least one chunk.");
    }

    return Object.freeze({
      byteLength: this.byteLengthValue,
      chunks: Object.freeze([...this.chunksValue]),
    });
  }
}

function createInputSample(
  chunks: readonly OwnedInputChunk[],
  originalByteLength: number,
  sampleSizeBytes: number,
): NormalizedInputSample {
  const normalizedSampleSizeBytes = normalizeSampleSizeBytes(sampleSizeBytes);
  const sampledByteLength = Math.min(originalByteLength, normalizedSampleSizeBytes);
  const sampledChunks: OwnedInputChunk[] = [];

  for (const chunk of chunks) {
    if (chunk.byteRange.start > sampledByteLength) {
      break;
    }

    if (chunk.byteRange.start === chunk.byteRange.end) {
      if (chunk.byteRange.start <= sampledByteLength) {
        sampledChunks.push(createOwnedInputChunk(new Uint8Array(), chunk.byteRange));
      }

      continue;
    }

    if (chunk.byteRange.start >= sampledByteLength) {
      break;
    }

    const sampledChunkEnd = Math.min(chunk.byteRange.end, sampledByteLength);

    sampledChunks.push(
      createOwnedInputChunk(chunk.bytes.subarray(0, sampledChunkEnd - chunk.byteRange.start), {
        start: chunk.byteRange.start,
        end: sampledChunkEnd,
      }),
    );

    if (sampledChunkEnd >= sampledByteLength) {
      break;
    }
  }

  return Object.freeze({
    bytes: concatenateOwnedChunks(sampledChunks, sampledByteLength),
    chunks: freezeInputChunkCopies(sampledChunks),
    sampledByteLength,
    originalByteLength,
    truncated: sampledByteLength < originalByteLength,
  });
}

function normalizeSampleSizeBytes(sampleSizeBytes: unknown): number {
  if (
    typeof sampleSizeBytes !== "number" ||
    !Number.isSafeInteger(sampleSizeBytes) ||
    sampleSizeBytes <= 0
  ) {
    throw new RangeError("Sample size must be a positive safe integer.");
  }

  return sampleSizeBytes;
}

function createOwnedInputChunk(bytes: Uint8Array, byteRange: SourceByteRange): OwnedInputChunk {
  return Object.freeze({
    byteRange: freezeSourceByteRange(byteRange),
    bytes: copyBytes(bytes),
  });
}

function concatenateOwnedChunks(
  chunks: readonly OwnedInputChunk[],
  byteLength: number,
): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }

  return bytes;
}

function freezeInputChunkCopies(
  chunks: readonly OwnedInputChunk[],
): readonly NormalizedInputChunk[] {
  return Object.freeze(
    chunks.map((chunk) =>
      Object.freeze({
        byteRange: freezeSourceByteRange(chunk.byteRange),
        bytes: copyBytes(chunk.bytes),
      }),
    ),
  );
}

function freezeSourceByteRange(range: SourceByteRange): SourceByteRange {
  return Object.freeze({
    start: range.start,
    end: range.end,
  });
}

function assertCanAppendBytes(
  currentByteLength: number,
  nextByteLength: number,
  inputKind: NormalizedByteInputKind,
): void {
  if (currentByteLength > Number.MAX_SAFE_INTEGER - nextByteLength) {
    throw new RangeError(`Encoding ${inputKind} input exceeds the maximum safe byte length.`);
  }
}

function assertChunkIsUint8Array(
  chunk: unknown,
  inputKind: NormalizedByteInputKind,
): asserts chunk is Uint8Array {
  if (!(chunk instanceof Uint8Array)) {
    throw new TypeError(`Encoding ${inputKind} chunks must be Uint8Array instances.`);
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function isReadableStreamInput(input: unknown): input is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && input instanceof ReadableStream;
}

function isAsyncIterableInput(input: unknown): input is AsyncIterable<Uint8Array> {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as { readonly [Symbol.asyncIterator]?: unknown };

  return typeof candidate[Symbol.asyncIterator] === "function";
}

function isIterableInput(input: unknown): input is Iterable<Uint8Array> {
  if (typeof input !== "object" || input === null) {
    return false;
  }

  const candidate = input as { readonly [Symbol.iterator]?: unknown };

  return typeof candidate[Symbol.iterator] === "function";
}

function invalidEncodingInputError(input: unknown): TypeError {
  const valueType = input === null ? "null" : typeof input;

  return new TypeError(
    `Encoding input must be a string, Uint8Array, ArrayBuffer, iterable of Uint8Array chunks, async iterable of Uint8Array chunks, or ReadableStream of Uint8Array chunks. Received ${valueType}.`,
  );
}
