import type { DecoderBackendInfo } from "../contracts/backend.js";
import type {
  EncodingCandidate,
  EncodingDetectionResult,
  NormalizedEncodingLabel,
} from "../contracts/detection.js";
import { createEncodingWarning, freezeEncodingWarnings } from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import { createEncodingError } from "../contracts/diagnostics.js";
import type { DecodedDocument } from "../contracts/document.js";
import type { DecodeDocumentOptions, RmemEncodingName } from "../contracts/encoding.js";
import type {
  OffsetMap,
  OffsetMapSegment,
  SourceByteRange,
  TextRange,
} from "../contracts/source.js";
import type {
  DecodedChunk,
  DecodingStream as DecodingStreamContract,
} from "../contracts/stream.js";
import { resolveDocumentOffsetMap, selectDocumentDecoderBackend } from "../DecodeDocumentCore.js";
import type { DecoderBackendSelection } from "../decoder/index.js";
import {
  normalizeDecodeDocumentOptions,
  type NormalizedDecodeDocumentOptions,
} from "../encoding/OptionsNormalization.js";
import { createDecodedDocument } from "../source/DecodedDocument.js";
import { createOffsetMap } from "../source/OffsetMap.js";
import { createSourceBufferFromChunks } from "../source/SourceBuffer.js";
import {
  createDetectionSamplerFromNormalizedOptions,
  type DetectionSampler,
  type DetectionSamplerChunk,
} from "./DetectionSampler.js";

interface StreamDecoderState {
  readonly detection: EncodingDetectionResult;
  readonly backendSelection: DecoderBackendSelection;
}

interface StreamChunk {
  readonly byteRange: SourceByteRange;
  readonly bytes: Uint8Array;
}

const EMPTY_DECODED_CHUNKS = Object.freeze([]) as readonly DecodedChunk[];
const HIGH_SURROGATE_BASE = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

export class DecodingStream implements DecodingStreamContract {
  readonly #normalizedOptions: NormalizedDecodeDocumentOptions;
  readonly #sampler: DetectionSampler;
  #decoderState: StreamDecoderState | undefined;
  #nextChunkIndex = 0;
  #charOffset = 0;
  #pendingChunk: StreamChunk | undefined;
  #pendingBackendWarnings: readonly EncodingWarning[] = EMPTY_WARNING_LIST;
  #decodedChunks: DecodedChunk[] = [];
  #ended = false;

  constructor(options?: DecodeDocumentOptions) {
    this.#normalizedOptions = normalizeDecodeDocumentOptions(options);
    this.#sampler = createDetectionSamplerFromNormalizedOptions(this.#normalizedOptions);

    Object.freeze(this);
  }

  get detection(): EncodingDetectionResult | undefined {
    return this.#decoderState?.detection ?? this.#sampler.detection;
  }

  write(chunk: Uint8Array): readonly DecodedChunk[] {
    this.#assertOpen();

    const hadDecoder = this.#decoderState !== undefined;
    const samplerResult = this.#sampler.write(chunk);

    if (!samplerResult.samplingComplete) {
      return EMPTY_DECODED_CHUNKS;
    }

    const decoderState = this.#ensureDecoderState(
      requiredDetection(samplerResult.detection ?? this.#sampler.detection),
    );
    const chunks = this.#sampler.chunks();

    if (!hadDecoder) {
      return this.#flushInitialBufferedChunks(chunks, decoderState);
    }

    return this.#flushNewChunks(chunks, decoderState);
  }

  end(): DecodedDocument {
    this.#assertOpen();
    this.#ended = true;

    const finishResult = this.#sampler.finish();
    const decoderState = this.#ensureDecoderState(finishResult.detection);

    if (this.#nextChunkIndex === 0) {
      this.#flushInitialBufferedChunks(finishResult.chunks, decoderState);
    } else {
      this.#flushNewChunks(finishResult.chunks, decoderState);
    }

    this.#finalizePendingChunk(decoderState);

    const source = createSourceBufferFromChunks(finishResult.chunks.map((chunk) => chunk.bytes));

    return createDecodedDocument({
      text: this.#decodedChunks.map((chunk) => chunk.text).join(""),
      source,
      detection: decoderState.detection,
      backend: decoderState.backendSelection.info,
      offsetMap: createOffsetMap(this.#globalOffsetMapSegments()),
      warnings: {
        sourceMap: this.#decodedChunks.flatMap((chunk) => chunk.warnings),
      },
    });
  }

  #flushInitialBufferedChunks(
    chunks: readonly DetectionSamplerChunk[],
    state: StreamDecoderState,
  ): readonly DecodedChunk[] {
    const bufferedChunk = combineSamplerChunks(chunks.slice(this.#nextChunkIndex));

    this.#nextChunkIndex = chunks.length;

    if (bufferedChunk === undefined) {
      return EMPTY_DECODED_CHUNKS;
    }

    return this.#recordDecodedChunks([this.#decodeAvailableChunk(bufferedChunk, state)]);
  }

  #flushNewChunks(
    chunks: readonly DetectionSamplerChunk[],
    state: StreamDecoderState,
  ): readonly DecodedChunk[] {
    const decodedChunks: (DecodedChunk | undefined)[] = [];

    for (let index = this.#nextChunkIndex; index < chunks.length; index += 1) {
      decodedChunks.push(this.#decodeAvailableChunk(requiredChunk(chunks[index]), state));
    }

    this.#nextChunkIndex = chunks.length;

    return this.#recordDecodedChunks(decodedChunks);
  }

  #decodeAvailableChunk(chunk: StreamChunk, state: StreamDecoderState): DecodedChunk | undefined {
    const pendingAwareChunk = this.#prependPendingChunk(chunk);
    const split = splitChunkForPendingState(pendingAwareChunk, state.detection.encoding);

    if (split.complete === undefined) {
      this.#pendingChunk = split.pending;
      return undefined;
    }

    const decodedChunk = this.#decodeChunk(split.complete, state);

    this.#pendingChunk = split.pending;

    return decodedChunk;
  }

  #ensureDecoderState(detection: EncodingDetectionResult): StreamDecoderState {
    if (this.#decoderState !== undefined) {
      return this.#decoderState;
    }

    const backendSelection = selectDocumentDecoderBackend(detection, this.#normalizedOptions);
    const decoderState = Object.freeze({
      detection: freezeDetectionResult(detection, backendSelection.info),
      backendSelection,
    });

    this.#decoderState = decoderState;
    this.#pendingBackendWarnings = backendSelection.warnings;

    return decoderState;
  }

  #decodeChunk(chunk: StreamChunk, state: StreamDecoderState): DecodedChunk {
    const textStart = this.#charOffset;
    const backendResult = state.backendSelection.backend.decode(chunk.bytes, {
      encoding: state.detection.encoding,
      stripBom: this.#shouldStripBom(chunk),
      sourceMap: this.#normalizedOptions.sourceMap,
      replacementPolicy: this.#normalizedOptions.replacementPolicy,
      replacementCharacter: this.#normalizedOptions.replacementCharacter,
    });
    const offsetMap = resolveDocumentOffsetMap({
      backendResult,
      backendInfo: state.backendSelection.info,
      sourceMap: this.#normalizedOptions.sourceMap,
      byteLength: chunk.bytes.byteLength,
      textLength: backendResult.text.length,
    });
    const textRange = freezeTextRange({
      start: textStart,
      end: textStart + backendResult.text.length,
    });
    const warnings = shiftEncodingWarnings(
      [...this.#consumeBackendWarnings(), ...backendResult.warnings],
      {
        byteOffset: chunk.byteRange.start,
        textOffset: textStart,
      },
    );

    this.#charOffset = textRange.end;

    return createDecodedChunk({
      text: backendResult.text,
      byteRange: chunk.byteRange,
      charRange: textRange,
      offsetMap,
      warnings,
    });
  }

  #shouldStripBom(chunk: StreamChunk): boolean {
    return this.#normalizedOptions.stripBom && chunk.byteRange.start === 0;
  }

  #consumeBackendWarnings(): readonly EncodingWarning[] {
    const warnings = this.#pendingBackendWarnings;

    this.#pendingBackendWarnings = EMPTY_WARNING_LIST;

    return warnings;
  }

  #prependPendingChunk(chunk: StreamChunk): StreamChunk {
    const pendingChunk = this.#pendingChunk;

    if (pendingChunk === undefined) {
      return chunk;
    }

    if (pendingChunk.byteRange.end !== chunk.byteRange.start) {
      throw new RangeError("Decoding stream pending bytes must be byte-continuous.");
    }

    this.#pendingChunk = undefined;

    return combineStreamChunks(pendingChunk, chunk);
  }

  #finalizePendingChunk(state: StreamDecoderState): void {
    const pendingChunk = this.#pendingChunk;

    if (pendingChunk === undefined) {
      return;
    }

    if (this.#normalizedOptions.replacementPolicy === "fatal") {
      throw createIncompleteStreamSequenceError(pendingChunk, state);
    }

    const replacementChunk = createIncompleteStreamReplacementChunk({
      chunk: pendingChunk,
      state,
      textStart: this.#charOffset,
      replacementCharacter: this.#normalizedOptions.replacementCharacter,
    });

    this.#charOffset = replacementChunk.charRange.end;
    this.#pendingChunk = undefined;
    this.#decodedChunks.push(replacementChunk);
  }

  #recordDecodedChunks(chunks: readonly (DecodedChunk | undefined)[]): readonly DecodedChunk[] {
    const decodedChunks = chunks.filter((chunk): chunk is DecodedChunk => chunk !== undefined);

    this.#decodedChunks.push(...decodedChunks);

    return decodedChunks.length === 0 ? EMPTY_DECODED_CHUNKS : Object.freeze(decodedChunks);
  }

  #globalOffsetMapSegments(): readonly OffsetMapSegment[] {
    return Object.freeze(
      this.#decodedChunks.flatMap((chunk) =>
        chunk.offsetMap.segments().map((segment) => shiftOffsetMapSegment(segment, chunk)),
      ),
    );
  }

  #assertOpen(): void {
    if (this.#ended) {
      throw new RangeError("Decoding stream cannot accept input after end.");
    }
  }
}

export function createDecodingStream(options?: DecodeDocumentOptions): DecodingStreamContract {
  return new DecodingStream(options);
}

function combineSamplerChunks(chunks: readonly DetectionSamplerChunk[]): StreamChunk | undefined {
  if (chunks.length === 0) {
    return undefined;
  }

  const firstChunk = requiredChunk(chunks[0]);
  const lastChunk = requiredChunk(chunks.at(-1));
  const byteLength = validateContinuousChunks(chunks, firstChunk.byteRange.start);
  const bytes = new Uint8Array(byteLength);
  let byteOffset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk.bytes, byteOffset);
    byteOffset += chunk.bytes.byteLength;
  }

  return freezeStreamChunk({
    byteRange: {
      start: firstChunk.byteRange.start,
      end: lastChunk.byteRange.end,
    },
    bytes,
  });
}

function combineStreamChunks(first: StreamChunk, second: StreamChunk): StreamChunk {
  const byteLength = first.bytes.byteLength + second.bytes.byteLength;
  const bytes = new Uint8Array(byteLength);

  bytes.set(first.bytes, 0);
  bytes.set(second.bytes, first.bytes.byteLength);

  return freezeStreamChunk({
    byteRange: {
      start: first.byteRange.start,
      end: second.byteRange.end,
    },
    bytes,
  });
}

function splitChunkForPendingState(
  chunk: StreamChunk,
  encoding: RmemEncodingName,
): {
  readonly complete?: StreamChunk;
  readonly pending?: StreamChunk;
} {
  const pendingStart = findPendingByteStart(chunk.bytes, encoding);

  if (pendingStart === chunk.bytes.byteLength) {
    return Object.freeze({
      complete: freezeStreamChunk(chunk),
    });
  }

  const complete = pendingStart === 0 ? undefined : sliceStreamChunk(chunk, 0, pendingStart);
  const pending = sliceStreamChunk(chunk, pendingStart, chunk.bytes.byteLength);

  return Object.freeze({
    ...optionalProperty("complete", complete),
    pending,
  });
}

function findPendingByteStart(bytes: Uint8Array, encoding: RmemEncodingName): number {
  switch (encoding) {
    case "utf-8":
      return findUtf8PendingByteStart(bytes);
    case "utf-16le":
      return findUtf16PendingByteStart(bytes, "le");
    case "utf-16be":
      return findUtf16PendingByteStart(bytes, "be");
    default:
      return bytes.byteLength;
  }
}

function findUtf8PendingByteStart(bytes: Uint8Array): number {
  const byteLength = bytes.byteLength;
  const scanStart = Math.max(0, byteLength - 4);

  for (let offset = byteLength - 1; offset >= scanStart; offset -= 1) {
    const sequence = readUtf8PendingSequence(bytes, offset);

    if (sequence !== undefined) {
      return offset;
    }
  }

  return byteLength;
}

function readUtf8PendingSequence(
  bytes: Uint8Array,
  byteOffset: number,
): { readonly expectedByteLength: number } | undefined {
  const first = readByte(bytes, byteOffset);
  const expectedByteLength = utf8ExpectedByteLength(first);

  if (expectedByteLength === undefined) {
    return undefined;
  }

  const availableByteLength = bytes.byteLength - byteOffset;

  if (
    availableByteLength >= expectedByteLength ||
    !isValidUtf8IncompletePrefix(bytes, byteOffset, availableByteLength, first)
  ) {
    return undefined;
  }

  return Object.freeze({ expectedByteLength });
}

function isValidUtf8IncompletePrefix(
  bytes: Uint8Array,
  byteOffset: number,
  availableByteLength: number,
  first: number,
): boolean {
  if (availableByteLength <= 1) {
    return true;
  }

  const second = readByte(bytes, byteOffset + 1);

  if (!acceptsUtf8SecondByte(first, second)) {
    return false;
  }

  if (availableByteLength <= 2) {
    return true;
  }

  return isUtf8ContinuationByte(readByte(bytes, byteOffset + 2));
}

function findUtf16PendingByteStart(bytes: Uint8Array, byteOrder: "le" | "be"): number {
  if (bytes.byteLength === 0) {
    return 0;
  }

  const hasTrailingHalfCodeUnit = bytes.byteLength % 2 === 1;
  const lastCompleteCodeUnitStart = hasTrailingHalfCodeUnit
    ? bytes.byteLength - 3
    : bytes.byteLength - 2;

  if (
    lastCompleteCodeUnitStart >= 0 &&
    isHighSurrogate(readUtf16CodeUnit(bytes, lastCompleteCodeUnitStart, byteOrder))
  ) {
    return lastCompleteCodeUnitStart;
  }

  return hasTrailingHalfCodeUnit ? bytes.byteLength - 1 : bytes.byteLength;
}

function sliceStreamChunk(chunk: StreamChunk, start: number, end: number): StreamChunk {
  return freezeStreamChunk({
    byteRange: {
      start: chunk.byteRange.start + start,
      end: chunk.byteRange.start + end,
    },
    bytes: chunk.bytes.subarray(start, end),
  });
}

function validateContinuousChunks(
  chunks: readonly DetectionSamplerChunk[],
  byteStart: number,
): number {
  let expectedStart = byteStart;
  let byteLength = 0;

  for (const chunk of chunks) {
    if (chunk.byteRange.start !== expectedStart) {
      throw new RangeError("Decoding stream buffered chunks must be byte-continuous.");
    }

    const chunkLength = chunk.byteRange.end - chunk.byteRange.start;
    if (chunkLength !== chunk.bytes.byteLength) {
      throw new RangeError("Decoding stream chunk byte range does not match its byte length.");
    }

    expectedStart = chunk.byteRange.end;
    byteLength += chunk.bytes.byteLength;
  }

  return byteLength;
}

function createDecodedChunk(options: {
  readonly text: string;
  readonly byteRange: SourceByteRange;
  readonly charRange: TextRange;
  readonly offsetMap: OffsetMap;
  readonly warnings: readonly EncodingWarning[];
}): DecodedChunk {
  return Object.freeze({
    text: options.text,
    byteRange: freezeSourceByteRange(options.byteRange),
    charRange: freezeTextRange(options.charRange),
    offsetMap: createOffsetMap(options.offsetMap.segments()),
    warnings: freezeEncodingWarnings(options.warnings),
  });
}

function createIncompleteStreamSequenceError(chunk: StreamChunk, state: StreamDecoderState) {
  return createEncodingError({
    code: "ENCODING_INCOMPLETE_STREAM_SEQUENCE",
    message: "Incomplete stream byte sequence.",
    byteRange: chunk.byteRange,
    details: incompleteStreamSequenceDetails(chunk, state),
  });
}

function createIncompleteStreamReplacementChunk(options: {
  readonly chunk: StreamChunk;
  readonly state: StreamDecoderState;
  readonly textStart: number;
  readonly replacementCharacter: string;
}): DecodedChunk {
  const textRange = freezeTextRange({
    start: options.textStart,
    end: options.textStart + options.replacementCharacter.length,
  });

  return createDecodedChunk({
    text: options.replacementCharacter,
    byteRange: options.chunk.byteRange,
    charRange: textRange,
    offsetMap: createOffsetMap([
      {
        byteRange: {
          start: 0,
          end: options.chunk.bytes.byteLength,
        },
        textRange: {
          start: 0,
          end: options.replacementCharacter.length,
        },
        kind: "replacement",
      },
    ]),
    warnings: [
      createEncodingWarning({
        code: "ENCODING_INCOMPLETE_STREAM_SEQUENCE",
        message: "Incomplete stream byte sequence was replaced.",
        byteRange: options.chunk.byteRange,
        textRange,
        details: {
          ...incompleteStreamSequenceDetails(options.chunk, options.state),
          replacementCharacter: options.replacementCharacter,
        },
      }),
    ],
  });
}

function incompleteStreamSequenceDetails(
  chunk: StreamChunk,
  state: StreamDecoderState,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    backend: state.backendSelection.info.name,
    encoding: state.detection.encoding,
    reason: incompleteStreamSequenceReason(chunk.bytes, state.detection.encoding),
  });
}

function incompleteStreamSequenceReason(bytes: Uint8Array, encoding: RmemEncodingName): string {
  switch (encoding) {
    case "utf-8":
      return "Incomplete UTF-8 sequence.";
    case "utf-16le":
    case "utf-16be":
      return bytes.byteLength % 2 === 1
        ? "Incomplete UTF-16 code unit."
        : "Incomplete UTF-16 surrogate pair.";
    default:
      return "Incomplete stream byte sequence.";
  }
}

function shiftOffsetMapSegment(segment: OffsetMapSegment, chunk: DecodedChunk): OffsetMapSegment {
  return {
    byteRange: shiftRequiredRange(segment.byteRange, chunk.byteRange.start),
    textRange: shiftRequiredRange(segment.textRange, chunk.charRange.start),
    kind: segment.kind,
  };
}

function shiftEncodingWarnings(
  warnings: readonly EncodingWarning[],
  offsets: {
    readonly byteOffset: number;
    readonly textOffset: number;
  },
): readonly EncodingWarning[] {
  return freezeEncodingWarnings(
    warnings.map((warning) =>
      createEncodingWarning({
        code: warning.code,
        severity: warning.severity,
        message: warning.message,
        ...optionalProperty("byteRange", shiftRange(warning.byteRange, offsets.byteOffset)),
        ...optionalProperty("textRange", shiftRange(warning.textRange, offsets.textOffset)),
        ...optionalProperty("details", warning.details),
      }),
    ),
  );
}

function shiftRange<TRange extends SourceByteRange | TextRange>(
  range: TRange | undefined,
  offset: number,
): TRange | undefined {
  if (range === undefined) {
    return undefined;
  }

  return {
    start: range.start + offset,
    end: range.end + offset,
  } as TRange;
}

function shiftRequiredRange<TRange extends SourceByteRange | TextRange>(
  range: TRange,
  offset: number,
): TRange {
  return {
    start: range.start + offset,
    end: range.end + offset,
  } as TRange;
}

function freezeDetectionResult(
  detection: EncodingDetectionResult,
  backend: DecoderBackendInfo,
): EncodingDetectionResult {
  return Object.freeze({
    encoding: detection.encoding,
    confidence: detection.confidence,
    source: detection.source,
    bomLength: detection.bomLength,
    candidates: Object.freeze(detection.candidates.map((candidate) => freezeCandidate(candidate))),
    warnings: freezeEncodingWarnings(detection.warnings),
    label: freezeNormalizedEncodingLabel(detection.label),
    backend: freezeDecoderBackendInfo(backend),
  });
}

function freezeCandidate(candidate: EncodingCandidate): EncodingCandidate {
  return Object.freeze({
    encoding: candidate.encoding,
    confidence: candidate.confidence,
    source: candidate.source,
    reason: candidate.reason,
    bomLength: candidate.bomLength,
  });
}

function freezeNormalizedEncodingLabel(label: NormalizedEncodingLabel): NormalizedEncodingLabel {
  return Object.freeze({
    ...optionalProperty("inputLabel", label.inputLabel),
    canonical: label.canonical,
    aliases: Object.freeze([...label.aliases]),
    source: label.source,
  });
}

function freezeDecoderBackendInfo(info: DecoderBackendInfo): DecoderBackendInfo {
  return Object.freeze({
    name: info.name,
    ...optionalProperty("version", info.version),
    exactSourceMap: info.exactSourceMap,
  });
}

function freezeStreamChunk(chunk: StreamChunk): StreamChunk {
  return Object.freeze({
    byteRange: freezeSourceByteRange(chunk.byteRange),
    bytes: new Uint8Array(chunk.bytes),
  });
}

function utf8ExpectedByteLength(first: number): number | undefined {
  if (first >= 0xc2 && first <= 0xdf) {
    return 2;
  }

  if (first >= 0xe0 && first <= 0xef) {
    return 3;
  }

  if (first >= 0xf0 && first <= 0xf4) {
    return 4;
  }

  return undefined;
}

function acceptsUtf8SecondByte(first: number, second: number): boolean {
  if (first === 0xe0) {
    return second >= 0xa0 && second <= 0xbf;
  }

  if (first === 0xed) {
    return second >= 0x80 && second <= 0x9f;
  }

  if (first === 0xf0) {
    return second >= 0x90 && second <= 0xbf;
  }

  if (first === 0xf4) {
    return second >= 0x80 && second <= 0x8f;
  }

  return isUtf8ContinuationByte(second);
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

function readUtf16CodeUnit(bytes: Uint8Array, byteOffset: number, byteOrder: "le" | "be"): number {
  const first = readByte(bytes, byteOffset);
  const second = readByte(bytes, byteOffset + 1);

  return byteOrder === "le" ? first | (second << 8) : (first << 8) | second;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_BASE && codeUnit <= HIGH_SURROGATE_END;
}

function readByte(bytes: Uint8Array, offset: number): number {
  const byte = bytes[offset];

  if (byte === undefined) {
    throw new RangeError("Byte offset is outside the input bounds.");
  }

  return byte;
}

function freezeSourceByteRange(range: SourceByteRange): SourceByteRange {
  return Object.freeze({
    start: range.start,
    end: range.end,
  });
}

function freezeTextRange(range: TextRange): TextRange {
  return Object.freeze({
    start: range.start,
    end: range.end,
  });
}

function requiredDetection(
  detection: EncodingDetectionResult | undefined,
): EncodingDetectionResult {
  if (detection === undefined) {
    throw new Error("Decoding stream sampling completed without a detection result.");
  }

  return detection;
}

function requiredChunk(chunk: DetectionSamplerChunk | undefined): DetectionSamplerChunk {
  if (chunk === undefined) {
    throw new Error("Decoding stream expected a buffered chunk.");
  }

  return chunk;
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

const EMPTY_WARNING_LIST = Object.freeze([]) as readonly EncodingWarning[];
