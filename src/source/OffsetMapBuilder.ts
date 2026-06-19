import type { ReplacementPolicy, RmemEncodingName } from "../contracts/encoding.js";
import {
  createEncodingError,
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingFailure, EncodingResult, EncodingWarning } from "../contracts/diagnostics.js";
import type { OffsetMap, OffsetMapSegment, OffsetMapSegmentKind } from "../contracts/source.js";
import {
  DEFAULT_DECODING_REPLACEMENT_CHARACTER,
  createInvalidSequenceError,
  createInvalidSequenceReplacementWarning,
} from "../encoding/ControlledDecodingPolicy.js";
import { decodeSingleByteCodePoint, isSingleByteEncoding } from "../encoding/SingleByteEncoding.js";
import type { SingleByteEncodingName } from "../encoding/SingleByteEncoding.js";
import { createOffsetMap } from "./OffsetMap.js";
import { validateSourceByteRange } from "./ranges.js";

export type Utf16ByteOrder = "le" | "be";

export interface OffsetMapBuilderOptions {
  readonly stripBom?: boolean;
  readonly replacementPolicy?: ReplacementPolicy;
  readonly replacementCharacter?: string;
}

export interface ExactOffsetMapBuilderOptions extends OffsetMapBuilderOptions {
  readonly encoding: RmemEncodingName;
}

export interface Utf16OffsetMapBuilderOptions extends OffsetMapBuilderOptions {
  readonly byteOrder: Utf16ByteOrder;
}

export interface SingleByteOffsetMapBuilderOptions extends OffsetMapBuilderOptions {
  readonly encoding?: SingleByteEncodingName;
}

export interface OffsetMapBuildResult {
  readonly offsetMap: OffsetMap;
  readonly segments: readonly OffsetMapSegment[];
  readonly warnings: readonly EncodingWarning[];
  readonly bomLength: number;
  readonly textLength: number;
}

export interface SyntheticUtf8StringOffsetMapBuildResult extends OffsetMapBuildResult {
  readonly bytes: Uint8Array;
}

interface NormalizedBuilderOptions {
  readonly stripBom: boolean;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

interface BuildContext {
  readonly encoding: RmemEncodingName;
  readonly options: NormalizedBuilderOptions;
  readonly segments: SegmentAccumulator;
  readonly warnings: EncodingWarning[];
  textOffset: number;
}

interface InvalidSequence {
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly reason: string;
}

interface Utf8Sequence {
  readonly byteLength: number;
  readonly textLength: number;
}

const UTF8_ENCODER = new TextEncoder();

export function buildExactOffsetMap(
  bytes: Uint8Array,
  options: ExactOffsetMapBuilderOptions,
): EncodingResult<OffsetMapBuildResult> {
  assertByteInput(bytes);

  switch (options.encoding) {
    case "utf-8":
      return buildUtf8OffsetMap(bytes, options);
    case "utf-16le":
      return buildUtf16LeOffsetMap(bytes, options);
    case "utf-16be":
      return buildUtf16BeOffsetMap(bytes, options);
    case "windows-1251":
    case "windows-1252":
    case "iso-8859-1":
    case "iso-8859-5":
    case "koi8-r":
    case "cp866":
      return buildSingleByteOffsetMap(bytes, { ...options, encoding: options.encoding });
    default:
      return unsupportedEncodingFailure(options.encoding);
  }
}

export function buildIdentityOffsetMap(byteLength: number): OffsetMapBuildResult {
  validateSourceByteRange({ start: 0, end: byteLength });

  const segments =
    byteLength === 0 ? [] : [createSegment("identity", 0, byteLength, 0, byteLength)];

  return finalizeBuildResult(segments, [], 0, byteLength);
}

export function buildSyntheticUtf8StringOffsetMap(
  text: string,
): SyntheticUtf8StringOffsetMapBuildResult {
  assertTextInput(text);

  const bytes = UTF8_ENCODER.encode(text);
  const segments = new SegmentAccumulator();
  let byteOffset = 0;
  let textOffset = 0;

  while (textOffset < text.length) {
    const textLength = utf16ScalarLengthAt(text, textOffset);
    const byteLength = UTF8_ENCODER.encode(
      text.slice(textOffset, textOffset + textLength),
    ).byteLength;

    segments.add("synthetic", byteOffset, byteOffset + byteLength, textOffset, textLength);
    byteOffset += byteLength;
    textOffset += textLength;
  }

  const result = finalizeBuildResult(segments.snapshot(), [], 0, text.length);

  return Object.freeze({
    ...result,
    bytes,
  });
}

export function buildSingleByteOffsetMap(
  bytes: Uint8Array,
  options: SingleByteOffsetMapBuilderOptions = {},
): EncodingResult<OffsetMapBuildResult> {
  assertByteInput(bytes);

  const encoding = normalizeSingleByteEncoding(options.encoding);
  const context = createBuildContext(encoding, options);
  let byteOffset = 0;

  while (byteOffset < bytes.byteLength) {
    const byte = readByte(bytes, byteOffset);
    const codePoint = decodeSingleByteCodePoint(byte, encoding);

    if (codePoint === undefined) {
      const invalid = {
        byteStart: byteOffset,
        byteEnd: byteOffset + 1,
        reason: "Unmapped single-byte value.",
      };
      const handled = handleInvalidSequence(context, invalid);
      if (!handled.ok) {
        return handled;
      }

      byteOffset = invalid.byteEnd;
      continue;
    }

    context.segments.add("identity", byteOffset, byteOffset + 1, context.textOffset, 1);
    context.textOffset += 1;
    byteOffset += 1;
  }

  return encodingSuccess(finishContext(context, 0));
}

export function buildUtf8OffsetMap(
  bytes: Uint8Array,
  options: OffsetMapBuilderOptions = {},
): EncodingResult<OffsetMapBuildResult> {
  assertByteInput(bytes);

  const context = createBuildContext("utf-8", options);
  const bomLength = readUtf8BomLength(bytes);

  appendBomSegment(context, bomLength, bomLength > 0);

  let byteOffset = bomLength;
  while (byteOffset < bytes.byteLength) {
    const byte = readByte(bytes, byteOffset);

    if (byte <= 0x7f) {
      context.segments.add("identity", byteOffset, byteOffset + 1, context.textOffset, 1);
      context.textOffset += 1;
      byteOffset += 1;
      continue;
    }

    const sequence = readUtf8Sequence(bytes, byteOffset);

    if ("byteLength" in sequence) {
      context.segments.add(
        "encoded",
        byteOffset,
        byteOffset + sequence.byteLength,
        context.textOffset,
        sequence.textLength,
      );
      context.textOffset += sequence.textLength;
      byteOffset += sequence.byteLength;
      continue;
    }

    const handled = handleInvalidSequence(context, sequence);
    if (!handled.ok) {
      return handled;
    }

    byteOffset = sequence.byteEnd;
  }

  return encodingSuccess(finishContext(context, bomLength));
}

export function buildUtf16LeOffsetMap(
  bytes: Uint8Array,
  options: OffsetMapBuilderOptions = {},
): EncodingResult<OffsetMapBuildResult> {
  return buildUtf16OffsetMap(bytes, { ...options, byteOrder: "le" });
}

export function buildUtf16BeOffsetMap(
  bytes: Uint8Array,
  options: OffsetMapBuilderOptions = {},
): EncodingResult<OffsetMapBuildResult> {
  return buildUtf16OffsetMap(bytes, { ...options, byteOrder: "be" });
}

export function buildUtf16OffsetMap(
  bytes: Uint8Array,
  options: Utf16OffsetMapBuilderOptions,
): EncodingResult<OffsetMapBuildResult> {
  assertByteInput(bytes);
  assertUtf16ByteOrder(options.byteOrder);

  const encoding = options.byteOrder === "le" ? "utf-16le" : "utf-16be";
  const context = createBuildContext(encoding, options);
  const bomLength = readUtf16BomLength(bytes, options.byteOrder);

  appendBomSegment(context, bomLength, bomLength > 0);

  let byteOffset = bomLength;
  while (byteOffset < bytes.byteLength) {
    if (byteOffset + 1 >= bytes.byteLength) {
      const invalid = {
        byteStart: byteOffset,
        byteEnd: byteOffset + 1,
        reason: "Incomplete UTF-16 code unit.",
      };
      const handled = handleInvalidSequence(context, invalid);
      if (!handled.ok) {
        return handled;
      }

      byteOffset = invalid.byteEnd;
      continue;
    }

    const codeUnit = readUtf16CodeUnit(bytes, byteOffset, options.byteOrder);

    if (isHighSurrogate(codeUnit)) {
      const nextByteOffset = byteOffset + 2;

      if (nextByteOffset + 1 >= bytes.byteLength) {
        const invalid = {
          byteStart: byteOffset,
          byteEnd: nextByteOffset,
          reason: "Unpaired UTF-16 high surrogate.",
        };
        const handled = handleInvalidSequence(context, invalid);
        if (!handled.ok) {
          return handled;
        }

        byteOffset = invalid.byteEnd;
        continue;
      }

      const nextCodeUnit = readUtf16CodeUnit(bytes, nextByteOffset, options.byteOrder);
      if (!isLowSurrogate(nextCodeUnit)) {
        const invalid = {
          byteStart: byteOffset,
          byteEnd: nextByteOffset,
          reason: "Unpaired UTF-16 high surrogate.",
        };
        const handled = handleInvalidSequence(context, invalid);
        if (!handled.ok) {
          return handled;
        }

        byteOffset = invalid.byteEnd;
        continue;
      }

      context.segments.add("encoded", byteOffset, byteOffset + 4, context.textOffset, 2);
      context.textOffset += 2;
      byteOffset += 4;
      continue;
    }

    if (isLowSurrogate(codeUnit)) {
      const invalid = {
        byteStart: byteOffset,
        byteEnd: byteOffset + 2,
        reason: "Unpaired UTF-16 low surrogate.",
      };
      const handled = handleInvalidSequence(context, invalid);
      if (!handled.ok) {
        return handled;
      }

      byteOffset = invalid.byteEnd;
      continue;
    }

    context.segments.add("encoded", byteOffset, byteOffset + 2, context.textOffset, 1);
    context.textOffset += 1;
    byteOffset += 2;
  }

  return encodingSuccess(finishContext(context, bomLength));
}

class SegmentAccumulator {
  private readonly segmentList: OffsetMapSegment[] = [];

  add(
    kind: OffsetMapSegmentKind,
    byteStart: number,
    byteEnd: number,
    textStart: number,
    textLength: number,
  ): void {
    const textEnd = textStart + textLength;
    const previous = this.segmentList.at(-1);

    if (
      previous !== undefined &&
      canMergeSegments(previous, kind, byteStart, textStart, byteEnd, textEnd)
    ) {
      this.segmentList[this.segmentList.length - 1] = createSegment(
        previous.kind,
        previous.byteRange.start,
        byteEnd,
        previous.textRange.start,
        textEnd,
      );
      return;
    }

    this.segmentList.push(createSegment(kind, byteStart, byteEnd, textStart, textEnd));
  }

  snapshot(): readonly OffsetMapSegment[] {
    return Object.freeze([...this.segmentList]);
  }
}

function createBuildContext(
  encoding: RmemEncodingName,
  options: OffsetMapBuilderOptions,
): BuildContext {
  return {
    encoding,
    options: normalizeBuilderOptions(options),
    segments: new SegmentAccumulator(),
    warnings: [],
    textOffset: 0,
  };
}

function normalizeBuilderOptions(options: OffsetMapBuilderOptions): NormalizedBuilderOptions {
  if (options.stripBom !== undefined && typeof options.stripBom !== "boolean") {
    throw new TypeError("stripBom must be a boolean.");
  }

  if (options.replacementPolicy !== undefined && !isReplacementPolicy(options.replacementPolicy)) {
    throw new RangeError("Replacement policy must be one of: fatal, replace.");
  }

  if (
    options.replacementCharacter !== undefined &&
    typeof options.replacementCharacter !== "string"
  ) {
    throw new TypeError("Replacement character must be a string.");
  }

  return {
    stripBom: options.stripBom ?? true,
    replacementPolicy: options.replacementPolicy ?? "fatal",
    replacementCharacter: options.replacementCharacter ?? DEFAULT_DECODING_REPLACEMENT_CHARACTER,
  };
}

function normalizeSingleByteEncoding(encoding: unknown): SingleByteEncodingName {
  if (encoding === undefined) {
    return "iso-8859-1";
  }

  if (!isSingleByteEncoding(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Unsupported single-byte encoding.",
      details: {
        encoding,
      },
    });
  }

  return encoding;
}

function appendBomSegment(context: BuildContext, bomLength: number, hasBom: boolean): void {
  if (!hasBom) {
    return;
  }

  const textLength = context.options.stripBom ? 0 : 1;
  context.segments.add("bom", 0, bomLength, 0, textLength);
  context.textOffset += textLength;
}

function handleInvalidSequence(
  context: BuildContext,
  invalid: InvalidSequence,
): EncodingResult<undefined> {
  const byteRange = validateSourceByteRange({
    start: invalid.byteStart,
    end: invalid.byteEnd,
  });

  if (context.options.replacementPolicy === "fatal") {
    return encodingFailure(
      createInvalidSequenceError({
        encoding: context.encoding,
        reason: invalid.reason,
        byteRange,
      }),
    );
  }

  const textRange = {
    start: context.textOffset,
    end: context.textOffset + context.options.replacementCharacter.length,
  };

  context.segments.add(
    "replacement",
    invalid.byteStart,
    invalid.byteEnd,
    context.textOffset,
    context.options.replacementCharacter.length,
  );
  context.warnings.push(
    createInvalidSequenceReplacementWarning({
      encoding: context.encoding,
      reason: invalid.reason,
      byteRange,
      textRange,
      replacementCharacter: context.options.replacementCharacter,
    }),
  );
  context.textOffset = textRange.end;

  return encodingSuccess(undefined);
}

function finishContext(context: BuildContext, bomLength: number): OffsetMapBuildResult {
  return finalizeBuildResult(
    context.segments.snapshot(),
    context.warnings,
    bomLength,
    context.textOffset,
  );
}

function finalizeBuildResult(
  segments: readonly OffsetMapSegment[],
  warnings: readonly EncodingWarning[],
  bomLength: number,
  textLength: number,
): OffsetMapBuildResult {
  const offsetMap = createOffsetMap(segments);

  return Object.freeze({
    offsetMap,
    segments: offsetMap.segments(),
    warnings: freezeEncodingWarnings(warnings),
    bomLength,
    textLength,
  });
}

function readUtf8Sequence(bytes: Uint8Array, byteOffset: number): Utf8Sequence | InvalidSequence {
  const first = readByte(bytes, byteOffset);

  if (first >= 0xc2 && first <= 0xdf) {
    return readContinuationSequence(bytes, byteOffset, 2, 1, isUtf8ContinuationByte);
  }

  if (first >= 0xe0 && first <= 0xef) {
    return readContinuationSequence(bytes, byteOffset, 3, 1, (second) => {
      if (first === 0xe0) {
        return second >= 0xa0 && second <= 0xbf;
      }

      if (first === 0xed) {
        return second >= 0x80 && second <= 0x9f;
      }

      return isUtf8ContinuationByte(second);
    });
  }

  if (first >= 0xf0 && first <= 0xf4) {
    return readContinuationSequence(bytes, byteOffset, 4, 2, (second) => {
      if (first === 0xf0) {
        return second >= 0x90 && second <= 0xbf;
      }

      if (first === 0xf4) {
        return second >= 0x80 && second <= 0x8f;
      }

      return isUtf8ContinuationByte(second);
    });
  }

  return {
    byteStart: byteOffset,
    byteEnd: byteOffset + 1,
    reason: "Invalid UTF-8 leading byte.",
  };
}

function readContinuationSequence(
  bytes: Uint8Array,
  byteOffset: number,
  byteLength: number,
  textLength: number,
  acceptsSecondByte: (byte: number) => boolean,
): Utf8Sequence | InvalidSequence {
  let consumedBytes = 1;

  for (let index = 1; index < byteLength; index += 1) {
    const currentOffset = byteOffset + index;

    if (currentOffset >= bytes.byteLength) {
      return {
        byteStart: byteOffset,
        byteEnd: byteOffset + consumedBytes,
        reason: "Incomplete UTF-8 sequence.",
      };
    }

    const byte = readByte(bytes, currentOffset);
    const isValidContinuation =
      index === 1 ? acceptsSecondByte(byte) : isUtf8ContinuationByte(byte);

    if (!isValidContinuation) {
      return {
        byteStart: byteOffset,
        byteEnd: byteOffset + consumedBytes,
        reason: "Invalid UTF-8 continuation byte.",
      };
    }

    consumedBytes += 1;
  }

  return {
    byteLength,
    textLength,
  };
}

function readUtf16BomLength(bytes: Uint8Array, byteOrder: Utf16ByteOrder): number {
  if (bytes.byteLength < 2) {
    return 0;
  }

  const first = readByte(bytes, 0);
  const second = readByte(bytes, 1);

  if (byteOrder === "le" && first === 0xff && second === 0xfe) {
    return 2;
  }

  if (byteOrder === "be" && first === 0xfe && second === 0xff) {
    return 2;
  }

  return 0;
}

function readUtf8BomLength(bytes: Uint8Array): number {
  if (bytes.byteLength < 3) {
    return 0;
  }

  return readByte(bytes, 0) === 0xef && readByte(bytes, 1) === 0xbb && readByte(bytes, 2) === 0xbf
    ? 3
    : 0;
}

function readUtf16CodeUnit(
  bytes: Uint8Array,
  byteOffset: number,
  byteOrder: Utf16ByteOrder,
): number {
  const first = readByte(bytes, byteOffset);
  const second = readByte(bytes, byteOffset + 1);

  return byteOrder === "le" ? first | (second << 8) : (first << 8) | second;
}

function readByte(bytes: Uint8Array, offset: number): number {
  const byte = bytes[offset];

  if (byte === undefined) {
    throw new RangeError("Byte offset is outside the input bounds.");
  }

  return byte;
}

function canMergeSegments(
  previous: OffsetMapSegment,
  kind: OffsetMapSegmentKind,
  byteStart: number,
  textStart: number,
  byteEnd: number,
  textEnd: number,
): boolean {
  return (
    kind === "identity" &&
    previous.kind === "identity" &&
    previous.byteRange.end === byteStart &&
    previous.textRange.end === textStart &&
    byteEnd - byteStart === textEnd - textStart
  );
}

function createSegment(
  kind: OffsetMapSegmentKind,
  byteStart: number,
  byteEnd: number,
  textStart: number,
  textEnd: number,
): OffsetMapSegment {
  return {
    byteRange: { start: byteStart, end: byteEnd },
    textRange: { start: textStart, end: textEnd },
    kind,
  };
}

function unsupportedEncodingFailure(encoding: never): EncodingFailure {
  return encodingFailure(
    createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Unsupported encoding.",
      details: { encoding },
    }),
  );
}

function isUtf8ContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function utf16ScalarLengthAt(text: string, offset: number): number {
  const codeUnit = text.charCodeAt(offset);
  const nextCodeUnit = text.charCodeAt(offset + 1);

  return isHighSurrogate(codeUnit) && isLowSurrogate(nextCodeUnit) ? 2 : 1;
}

function assertUtf16ByteOrder(byteOrder: string): asserts byteOrder is Utf16ByteOrder {
  if (byteOrder !== "le" && byteOrder !== "be") {
    throw new RangeError("UTF-16 byte order must be one of: le, be.");
  }
}

function isReplacementPolicy(policy: string): policy is ReplacementPolicy {
  return policy === "fatal" || policy === "replace";
}

function assertByteInput(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("OffsetMap builder input must be a Uint8Array.");
  }
}

function assertTextInput(text: string): void {
  if (typeof text !== "string") {
    throw new TypeError("Synthetic OffsetMap builder input must be a string.");
  }
}
