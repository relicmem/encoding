import type { EncodingDetectionResult } from "../contracts/detection.js";
import type { DecodeDocumentOptions } from "../contracts/encoding.js";
import type { SourceByteRange } from "../contracts/source.js";
import {
  createCompositeDetectionInputSampleSnapshot,
  detectNormalizedCompositeEncodingFromSample,
} from "../detector/CompositeDetector.js";
import {
  normalizeDecodeDocumentOptions,
  type NormalizedDecodeDocumentOptions,
} from "../encoding/OptionsNormalization.js";

export interface DetectionSamplerChunk {
  readonly byteRange: SourceByteRange;
  readonly bytes: Uint8Array;
}

export interface DetectionSamplerSample {
  readonly bytes: Uint8Array;
  readonly chunks: readonly DetectionSamplerChunk[];
  readonly sampledByteLength: number;
  readonly bufferedByteLength: number;
  readonly truncated: boolean;
}

export interface DetectionSamplerWriteResult {
  readonly detection?: EncodingDetectionResult;
  readonly samplingComplete: boolean;
  readonly sampledByteLength: number;
  readonly bufferedByteLength: number;
}

export interface DetectionSamplerFinishResult {
  readonly detection: EncodingDetectionResult;
  readonly chunks: readonly DetectionSamplerChunk[];
  readonly sample: DetectionSamplerSample;
}

interface OwnedSamplerChunk {
  readonly byteRange: SourceByteRange;
  readonly bytes: Uint8Array;
}

const UTF_BOM_PATTERNS = Object.freeze([
  Object.freeze([0xef, 0xbb, 0xbf]),
  Object.freeze([0xff, 0xfe]),
  Object.freeze([0xfe, 0xff]),
] as const);

export class DetectionSampler {
  readonly #normalizedOptions: NormalizedDecodeDocumentOptions;
  readonly #chunks: OwnedSamplerChunk[] = [];
  readonly #sampleChunks: OwnedSamplerChunk[] = [];
  #byteLength = 0;
  #sampledByteLength = 0;
  #detection: EncodingDetectionResult | undefined;
  #finished = false;

  constructor(normalizedOptions: NormalizedDecodeDocumentOptions) {
    this.#normalizedOptions = normalizedOptions;

    Object.freeze(this);
  }

  get detection(): EncodingDetectionResult | undefined {
    return this.#detection;
  }

  get byteLength(): number {
    return this.#byteLength;
  }

  get sampledByteLength(): number {
    return this.#sampledByteLength;
  }

  get samplingComplete(): boolean {
    return this.#detection !== undefined;
  }

  write(chunk: Uint8Array): DetectionSamplerWriteResult {
    this.#assertOpen();
    assertChunkIsUint8Array(chunk);
    assertCanAppendBytes(this.#byteLength, chunk.byteLength);

    const ownedChunk = createOwnedSamplerChunk(chunk, {
      start: this.#byteLength,
      end: this.#byteLength + chunk.byteLength,
    });

    this.#chunks.push(ownedChunk);
    this.#byteLength += chunk.byteLength;
    this.#appendSampleChunk(ownedChunk);

    if (this.#detection === undefined) {
      this.#commitDetectionIfReady();
    } else {
      this.#refreshDetectionFromCurrentSample(false);
    }

    return createDetectionSamplerWriteResult({
      ...optionalProperty("detection", this.#detection),
      samplingComplete: this.samplingComplete,
      sampledByteLength: this.#sampledByteLength,
      bufferedByteLength: this.#byteLength,
    });
  }

  finish(): DetectionSamplerFinishResult {
    this.#assertOpen();
    this.#commitDetection();
    this.#finished = true;

    return Object.freeze({
      detection: requiredDetection(this.#detection),
      chunks: this.chunks(),
      sample: this.sample(),
    });
  }

  chunks(): readonly DetectionSamplerChunk[] {
    return freezeSamplerChunkCopies(this.#chunks);
  }

  sample(): DetectionSamplerSample {
    return createDetectionSamplerSample({
      chunks: this.#sampleChunks,
      sampledByteLength: this.#sampledByteLength,
      bufferedByteLength: this.#byteLength,
    });
  }

  #appendSampleChunk(chunk: OwnedSamplerChunk): void {
    if (this.#detection !== undefined) {
      return;
    }

    if (chunk.byteRange.start === chunk.byteRange.end) {
      if (this.#sampledByteLength < this.#normalizedOptions.sampleSizeBytes) {
        this.#sampleChunks.push(createOwnedSamplerChunk(new Uint8Array(), chunk.byteRange));
      }

      return;
    }

    if (this.#sampledByteLength >= this.#normalizedOptions.sampleSizeBytes) {
      return;
    }

    const remainingSampleBytes = this.#normalizedOptions.sampleSizeBytes - this.#sampledByteLength;
    const sampledChunkLength = Math.min(chunk.bytes.byteLength, remainingSampleBytes);
    const sampledByteRange = {
      start: chunk.byteRange.start,
      end: chunk.byteRange.start + sampledChunkLength,
    };

    this.#sampleChunks.push(
      createOwnedSamplerChunk(chunk.bytes.subarray(0, sampledChunkLength), sampledByteRange),
    );
    this.#sampledByteLength += sampledChunkLength;
  }

  #commitDetectionIfReady(): void {
    if (this.#detection !== undefined) {
      return;
    }

    const sampleBytes = sampleBytesFromChunks(this.#sampleChunks, this.#sampledByteLength);

    if (
      this.#sampledByteLength >= this.#normalizedOptions.sampleSizeBytes ||
      hasCompleteBom(sampleBytes) ||
      (hasHigherPriorityDetectionSignal(this.#normalizedOptions) &&
        isBomPrefixResolved(sampleBytes))
    ) {
      this.#commitDetectionFromSample(sampleBytes, false);
    }
  }

  #commitDetection(): void {
    if (this.#detection !== undefined) {
      this.#refreshDetectionFromCurrentSample(true);
      return;
    }

    this.#commitDetectionFromSample(
      sampleBytesFromChunks(this.#sampleChunks, this.#sampledByteLength),
      true,
    );
  }

  #commitDetectionFromSample(sampleBytes: Uint8Array, inputComplete: boolean): void {
    this.#detection = detectNormalizedCompositeEncodingFromSample(
      createCompositeDetectionInputSampleSnapshot({
        bytes: sampleBytes,
        sampledByteLength: this.#sampledByteLength,
        originalByteLength: this.#byteLength,
        inputComplete,
      }),
      this.#normalizedOptions,
    );
  }

  #refreshDetectionFromCurrentSample(inputComplete: boolean): void {
    if (this.#detection === undefined) {
      return;
    }

    this.#commitDetectionFromSample(
      sampleBytesFromChunks(this.#sampleChunks, this.#sampledByteLength),
      inputComplete,
    );
  }

  #assertOpen(): void {
    if (this.#finished) {
      throw new RangeError("Detection sampler cannot accept input after finish.");
    }
  }
}

export function createDetectionSampler(options?: DecodeDocumentOptions): DetectionSampler {
  return new DetectionSampler(normalizeDecodeDocumentOptions(options));
}

export function createDetectionSamplerFromNormalizedOptions(
  options: NormalizedDecodeDocumentOptions,
): DetectionSampler {
  return new DetectionSampler(options);
}

function hasHigherPriorityDetectionSignal(options: NormalizedDecodeDocumentOptions): boolean {
  return options.explicitEncoding !== undefined || options.metadataSniffing.candidate !== undefined;
}

function isBomPrefixResolved(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) {
    return false;
  }

  if (hasCompleteBom(bytes)) {
    return true;
  }

  return !UTF_BOM_PATTERNS.some(
    (pattern) => bytes.byteLength < pattern.length && startsWithPattern(bytes, pattern),
  );
}

function hasCompleteBom(bytes: Uint8Array): boolean {
  return UTF_BOM_PATTERNS.some(
    (pattern) => bytes.byteLength >= pattern.length && startsWithPattern(bytes, pattern),
  );
}

function startsWithPattern(bytes: Uint8Array, pattern: readonly number[]): boolean {
  const prefixLength = Math.min(bytes.byteLength, pattern.length);

  for (let index = 0; index < prefixLength; index += 1) {
    if (bytes[index] !== pattern[index]) {
      return false;
    }
  }

  return true;
}

function sampleBytesFromChunks(
  chunks: readonly OwnedSamplerChunk[],
  sampledByteLength: number,
): Uint8Array {
  const bytes = new Uint8Array(sampledByteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk.bytes, offset);
    offset += chunk.bytes.byteLength;
  }

  return bytes;
}

function createDetectionSamplerWriteResult(
  options: DetectionSamplerWriteResult,
): DetectionSamplerWriteResult {
  return Object.freeze({
    ...optionalProperty("detection", options.detection),
    samplingComplete: options.samplingComplete,
    sampledByteLength: options.sampledByteLength,
    bufferedByteLength: options.bufferedByteLength,
  });
}

function createDetectionSamplerSample(options: {
  readonly chunks: readonly OwnedSamplerChunk[];
  readonly sampledByteLength: number;
  readonly bufferedByteLength: number;
}): DetectionSamplerSample {
  return Object.freeze({
    bytes: sampleBytesFromChunks(options.chunks, options.sampledByteLength),
    chunks: freezeSamplerChunkCopies(options.chunks),
    sampledByteLength: options.sampledByteLength,
    bufferedByteLength: options.bufferedByteLength,
    truncated: options.sampledByteLength < options.bufferedByteLength,
  });
}

function createOwnedSamplerChunk(bytes: Uint8Array, byteRange: SourceByteRange): OwnedSamplerChunk {
  return Object.freeze({
    byteRange: freezeSourceByteRange(byteRange),
    bytes: copyBytes(bytes),
  });
}

function freezeSamplerChunkCopies(
  chunks: readonly OwnedSamplerChunk[],
): readonly DetectionSamplerChunk[] {
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

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function assertCanAppendBytes(currentByteLength: number, nextByteLength: number): void {
  if (currentByteLength > Number.MAX_SAFE_INTEGER - nextByteLength) {
    throw new RangeError("Detection sampler byte length exceeds the maximum safe integer.");
  }
}

function assertChunkIsUint8Array(chunk: unknown): asserts chunk is Uint8Array {
  if (!(chunk instanceof Uint8Array)) {
    throw new TypeError("Detection sampler chunks must be Uint8Array instances.");
  }
}

function requiredDetection(
  detection: EncodingDetectionResult | undefined,
): EncodingDetectionResult {
  if (detection === undefined) {
    throw new Error("Detection sampler did not produce a detection result.");
  }

  return detection;
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
