import type {
  BackendDecodeOptions,
  BackendDecodeResult,
  DecoderBackend,
  DecoderBackendInfo,
  EncodeOptions,
  EncodeResult,
} from "../contracts/backend.js";
import {
  createEncodingError,
  freezeEncodingWarnings,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type { ReplacementPolicy, RmemEncodingName, SourceMapMode } from "../contracts/encoding.js";
import type { OffsetMap, OffsetMapSegment } from "../contracts/source.js";
import {
  createUnmappableCharacterError,
  createUnmappableCharacterReplacementWarning,
  normalizeControlledEncodingPolicy,
} from "../encoding/ControlledEncodingPolicy.js";
import {
  addEncodingWarningDetails,
  normalizeControlledDecodingPolicy,
} from "../encoding/ControlledDecodingPolicy.js";
import {
  SINGLE_BYTE_ENCODING_NAMES,
  decodeSingleByteCodePoint,
  encodeSingleByteCodePoint,
  isSingleByteEncoding,
} from "../encoding/SingleByteEncoding.js";
import type { SingleByteEncodingName } from "../encoding/SingleByteEncoding.js";
import { buildExactOffsetMap } from "../source/OffsetMapBuilder.js";
import type { OffsetMapBuildResult } from "../source/OffsetMapBuilder.js";

const NATIVE_UNICODE_ENCODINGS = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
] as const satisfies readonly RmemEncodingName[]);
const NATIVE_DECODER_ENCODINGS = Object.freeze([
  ...NATIVE_UNICODE_ENCODINGS,
  ...SINGLE_BYTE_ENCODING_NAMES,
] as const satisfies readonly RmemEncodingName[]);
const BYTE_MASK = 0x3f;
const HIGH_SURROGATE_BASE = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_BASE = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;
const SURROGATE_OFFSET = 0x10000;
const SURROGATE_SHIFT = 10;
const SURROGATE_MASK = 0x3ff;
const TEXT_CHUNK_CODE_UNITS = 8192;
const DEFAULT_NATIVE_ENCODE_REPLACEMENT = "?";
const UNMAPPED_CHARACTER_REASON = "Character is not representable in target encoding.";
const UNPAIRED_HIGH_SURROGATE_REASON = "Unpaired UTF-16 high surrogate.";
const UNPAIRED_LOW_SURROGATE_REASON = "Unpaired UTF-16 low surrogate.";

type NativeUnicodeEncodingName = (typeof NATIVE_UNICODE_ENCODINGS)[number];
type NativeDecoderEncodingName = NativeUnicodeEncodingName | SingleByteEncodingName;
type Utf16ByteOrder = "le" | "be";

interface NormalizedNativeDecodeOptions {
  readonly encoding: NativeDecoderEncodingName;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

interface NormalizedNativeEncodeOptions {
  readonly encoding: NativeDecoderEncodingName;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

interface NativeEncodeContext {
  readonly options: NormalizedNativeEncodeOptions;
  readonly writer: ByteWriter;
  readonly warnings: EncodingWarning[];
  readonly replacementBytes?: Uint8Array;
}

export class NativeUnicodeBackend implements DecoderBackend {
  readonly info: DecoderBackendInfo = Object.freeze({
    name: "native",
    version: "native-v1",
    exactSourceMap: true,
  });

  constructor() {
    Object.freeze(this);
  }

  canDecode(encoding: RmemEncodingName): boolean {
    return isNativeDecoderEncoding(encoding);
  }

  canEncode(encoding: RmemEncodingName): boolean {
    return isNativeDecoderEncoding(encoding);
  }

  decode(input: Uint8Array, options: BackendDecodeOptions): BackendDecodeResult {
    assertByteInput(input);

    const normalizedOptions = normalizeDecodeOptions(options);
    const mapResult = buildExactOffsetMap(input, {
      encoding: normalizedOptions.encoding,
      stripBom: normalizedOptions.stripBom,
      replacementPolicy: normalizedOptions.replacementPolicy,
      replacementCharacter: normalizedOptions.replacementCharacter,
    });

    if (!mapResult.ok) {
      throw mapResult.error;
    }

    const text = decodeTextFromOffsetMap(input, mapResult.value, normalizedOptions);

    return freezeDecodeResult({
      text,
      warnings: addEncodingWarningDetails(mapResult.value.warnings, { backend: "native" }),
      ...sourceMapOutput(normalizedOptions.sourceMap, mapResult.value),
    });
  }

  encode(input: string, encoding: RmemEncodingName, options?: EncodeOptions): EncodeResult {
    assertStringInput(input);

    const normalizedOptions = normalizeEncodeOptions(encoding, options);
    const encoded = encodeTextToBytes(input, normalizedOptions);

    return freezeEncodeResult({
      bytes: encoded.bytes,
      warnings: encoded.warnings,
    });
  }
}

export const NATIVE_UNICODE_BACKEND: NativeUnicodeBackend = new NativeUnicodeBackend();

export function createNativeUnicodeBackend(): NativeUnicodeBackend {
  return new NativeUnicodeBackend();
}

function encodeTextToBytes(
  input: string,
  options: NormalizedNativeEncodeOptions,
): {
  readonly bytes: Uint8Array;
  readonly warnings: readonly EncodingWarning[];
} {
  const context = createNativeEncodeContext(input, options);

  encodeTextIntoWriter(input, context);

  return {
    bytes: context.writer.finish(),
    warnings: freezeEncodingWarnings(context.warnings),
  };
}

function createNativeEncodeContext(
  input: string,
  options: NormalizedNativeEncodeOptions,
): NativeEncodeContext {
  const replacementBytes = createReplacementBytes(input, options);

  return {
    options,
    writer: new ByteWriter(),
    warnings: [],
    ...optionalProperty("replacementBytes", replacementBytes),
  };
}

function createReplacementBytes(
  input: string,
  options: NormalizedNativeEncodeOptions,
): Uint8Array | undefined {
  if (options.replacementPolicy === "fatal") {
    return undefined;
  }

  try {
    return encodeTextStrict(options.replacementCharacter, options.encoding);
  } catch (error) {
    if (isEncodingError(error) && error.code === "ENCODING_UNMAPPABLE_CHARACTER") {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Native backend replacement character cannot be encoded.",
        ...optionalProperty("textRange", error.textRange),
        details: {
          backend: "native",
          encoding: options.encoding,
          inputTextLength: input.length,
          replacementCharacter: options.replacementCharacter,
          reason: "replacement-character-unencodable",
        },
        cause: error,
      });
    }

    throw error;
  }
}

function encodeTextStrict(input: string, encoding: NativeDecoderEncodingName): Uint8Array {
  const context: NativeEncodeContext = {
    options: Object.freeze({
      encoding,
      replacementPolicy: "fatal",
      replacementCharacter: DEFAULT_NATIVE_ENCODE_REPLACEMENT,
    }),
    writer: new ByteWriter(),
    warnings: [],
  };

  encodeTextIntoWriter(input, context);

  return context.writer.finish();
}

function encodeTextIntoWriter(input: string, context: NativeEncodeContext): void {
  const encoding = context.options.encoding;

  if (isSingleByteEncoding(encoding)) {
    encodeSingleByteText(input, context, encoding);
    return;
  }

  switch (encoding) {
    case "utf-8":
      encodeUtf8Text(input, context);
      return;
    case "utf-16le":
      encodeUtf16Text(input, context, "le");
      return;
    case "utf-16be":
      encodeUtf16Text(input, context, "be");
      return;
  }
}

function encodeUtf8Text(input: string, context: NativeEncodeContext): void {
  let textOffset = 0;

  while (textOffset < input.length) {
    const codeUnit = input.charCodeAt(textOffset);
    const nextCodeUnit = readNextCodeUnit(input, textOffset);

    if (isHighSurrogate(codeUnit)) {
      if (isLowSurrogate(nextCodeUnit)) {
        appendUtf8CodePoint(context.writer, combineSurrogates(codeUnit, nextCodeUnit));
        textOffset += 2;
        continue;
      }

      handleUnmappableCharacter(context, {
        reason: UNPAIRED_HIGH_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    if (isLowSurrogate(codeUnit)) {
      handleUnmappableCharacter(context, {
        reason: UNPAIRED_LOW_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    appendUtf8CodePoint(context.writer, codeUnit);
    textOffset += 1;
  }
}

function encodeUtf16Text(
  input: string,
  context: NativeEncodeContext,
  byteOrder: Utf16ByteOrder,
): void {
  let textOffset = 0;

  while (textOffset < input.length) {
    const codeUnit = input.charCodeAt(textOffset);
    const nextCodeUnit = readNextCodeUnit(input, textOffset);

    if (isHighSurrogate(codeUnit)) {
      if (isLowSurrogate(nextCodeUnit)) {
        appendUtf16CodeUnit(context.writer, codeUnit, byteOrder);
        appendUtf16CodeUnit(context.writer, nextCodeUnit, byteOrder);
        textOffset += 2;
        continue;
      }

      handleUnmappableCharacter(context, {
        reason: UNPAIRED_HIGH_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    if (isLowSurrogate(codeUnit)) {
      handleUnmappableCharacter(context, {
        reason: UNPAIRED_LOW_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    appendUtf16CodeUnit(context.writer, codeUnit, byteOrder);
    textOffset += 1;
  }
}

function encodeSingleByteText(
  input: string,
  context: NativeEncodeContext,
  encoding: SingleByteEncodingName,
): void {
  let textOffset = 0;

  while (textOffset < input.length) {
    const codeUnit = input.charCodeAt(textOffset);
    const nextCodeUnit = readNextCodeUnit(input, textOffset);

    if (isHighSurrogate(codeUnit)) {
      if (isLowSurrogate(nextCodeUnit)) {
        const codePoint = combineSurrogates(codeUnit, nextCodeUnit);
        appendSingleByteCodePoint(context, encoding, codePoint, textOffset, textOffset + 2);
        textOffset += 2;
        continue;
      }

      handleUnmappableCharacter(context, {
        reason: UNPAIRED_HIGH_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    if (isLowSurrogate(codeUnit)) {
      handleUnmappableCharacter(context, {
        reason: UNPAIRED_LOW_SURROGATE_REASON,
        textStart: textOffset,
        textEnd: textOffset + 1,
        codePoint: codeUnit,
      });
      textOffset += 1;
      continue;
    }

    appendSingleByteCodePoint(context, encoding, codeUnit, textOffset, textOffset + 1);
    textOffset += 1;
  }
}

function appendSingleByteCodePoint(
  context: NativeEncodeContext,
  encoding: SingleByteEncodingName,
  codePoint: number,
  textStart: number,
  textEnd: number,
): void {
  const byte = encodeSingleByteCodePoint(codePoint, encoding);

  if (byte === undefined) {
    handleUnmappableCharacter(context, {
      reason: UNMAPPED_CHARACTER_REASON,
      textStart,
      textEnd,
      codePoint,
    });
    return;
  }

  context.writer.appendByte(byte);
}

function appendUtf8CodePoint(writer: ByteWriter, codePoint: number): void {
  if (codePoint <= 0x7f) {
    writer.appendByte(codePoint);
    return;
  }

  if (codePoint <= 0x7ff) {
    writer.appendByte(0xc0 | (codePoint >> 6));
    writer.appendByte(0x80 | (codePoint & BYTE_MASK));
    return;
  }

  if (codePoint <= 0xffff) {
    writer.appendByte(0xe0 | (codePoint >> 12));
    writer.appendByte(0x80 | ((codePoint >> 6) & BYTE_MASK));
    writer.appendByte(0x80 | (codePoint & BYTE_MASK));
    return;
  }

  writer.appendByte(0xf0 | (codePoint >> 18));
  writer.appendByte(0x80 | ((codePoint >> 12) & BYTE_MASK));
  writer.appendByte(0x80 | ((codePoint >> 6) & BYTE_MASK));
  writer.appendByte(0x80 | (codePoint & BYTE_MASK));
}

function appendUtf16CodeUnit(
  writer: ByteWriter,
  codeUnit: number,
  byteOrder: Utf16ByteOrder,
): void {
  if (byteOrder === "le") {
    writer.appendByte(codeUnit & 0xff);
    writer.appendByte(codeUnit >> 8);
    return;
  }

  writer.appendByte(codeUnit >> 8);
  writer.appendByte(codeUnit & 0xff);
}

function handleUnmappableCharacter(
  context: NativeEncodeContext,
  options: {
    readonly reason: string;
    readonly textStart: number;
    readonly textEnd: number;
    readonly codePoint: number;
  },
): void {
  const diagnosticOptions = {
    encoding: context.options.encoding,
    reason: options.reason,
    textRange: {
      start: options.textStart,
      end: options.textEnd,
    },
    codePoint: options.codePoint,
    details: {
      backend: "native",
    },
  };

  if (context.options.replacementPolicy === "fatal") {
    throw createUnmappableCharacterError(diagnosticOptions);
  }

  const replacementBytes = context.replacementBytes;

  if (replacementBytes === undefined) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend replacement bytes are unavailable.",
      textRange: diagnosticOptions.textRange,
      details: {
        backend: "native",
        encoding: context.options.encoding,
      },
    });
  }

  context.warnings.push(
    createUnmappableCharacterReplacementWarning({
      ...diagnosticOptions,
      replacementCharacter: context.options.replacementCharacter,
    }),
  );
  context.writer.appendBytes(replacementBytes);
}

function readNextCodeUnit(input: string, offset: number): number | undefined {
  return offset + 1 < input.length ? input.charCodeAt(offset + 1) : undefined;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_BASE && codeUnit <= HIGH_SURROGATE_END;
}

function isLowSurrogate(codeUnit: number | undefined): codeUnit is number {
  return codeUnit !== undefined && codeUnit >= LOW_SURROGATE_BASE && codeUnit <= LOW_SURROGATE_END;
}

function combineSurrogates(highSurrogate: number, lowSurrogate: number): number {
  return (
    SURROGATE_OFFSET +
    ((highSurrogate - HIGH_SURROGATE_BASE) << SURROGATE_SHIFT) +
    (lowSurrogate - LOW_SURROGATE_BASE)
  );
}

function decodeTextFromOffsetMap(
  bytes: Uint8Array,
  buildResult: OffsetMapBuildResult,
  options: NormalizedNativeDecodeOptions,
): string {
  const writer = new TextChunkWriter();

  for (const segment of buildResult.segments) {
    appendSegmentText(writer, bytes, segment, options);
  }

  const text = writer.finish();

  if (text.length !== buildResult.textLength) {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Native backend produced text that does not match its source map.",
      details: {
        backend: "native",
        encoding: options.encoding,
        expectedTextLength: buildResult.textLength,
        actualTextLength: text.length,
      },
    });
  }

  return text;
}

function appendSegmentText(
  writer: TextChunkWriter,
  bytes: Uint8Array,
  segment: OffsetMapSegment,
  options: NormalizedNativeDecodeOptions,
): void {
  switch (segment.kind) {
    case "identity":
      appendIdentity(
        writer,
        bytes,
        segment.byteRange.start,
        segment.byteRange.end,
        options.encoding,
      );
      return;
    case "encoded":
      appendEncoded(
        writer,
        bytes,
        segment.byteRange.start,
        segment.byteRange.end,
        options.encoding,
      );
      return;
    case "bom":
      if (segment.textRange.end > segment.textRange.start) {
        writer.appendCodeUnit(0xfeff);
      }
      return;
    case "replacement":
      writer.appendString(options.replacementCharacter);
      return;
    case "synthetic":
      throw createEncodingError({
        code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
        message: "Native backend cannot decode synthetic offset map segments.",
        details: {
          backend: "native",
          encoding: options.encoding,
        },
      });
  }
}

function appendEncoded(
  writer: TextChunkWriter,
  bytes: Uint8Array,
  start: number,
  end: number,
  encoding: NativeDecoderEncodingName,
): void {
  if (!isNativeUnicodeEncoding(encoding)) {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Native backend received an encoded segment for a single-byte encoding.",
      details: {
        backend: "native",
        encoding,
      },
    });
  }

  switch (encoding) {
    case "utf-8":
      appendUtf8(writer, bytes, start, end);
      return;
    case "utf-16le":
      appendUtf16(writer, bytes, start, end, "le");
      return;
    case "utf-16be":
      appendUtf16(writer, bytes, start, end, "be");
      return;
  }
}

function appendIdentity(
  writer: TextChunkWriter,
  bytes: Uint8Array,
  start: number,
  end: number,
  encoding: NativeDecoderEncodingName,
): void {
  if (isSingleByteEncoding(encoding)) {
    appendSingleByte(writer, bytes, start, end, encoding);
    return;
  }

  appendAscii(writer, bytes, start, end);
}

function appendAscii(writer: TextChunkWriter, bytes: Uint8Array, start: number, end: number): void {
  for (let offset = start; offset < end; offset += 1) {
    writer.appendCodeUnit(readByte(bytes, offset));
  }
}

function appendSingleByte(
  writer: TextChunkWriter,
  bytes: Uint8Array,
  start: number,
  end: number,
  encoding: SingleByteEncodingName,
): void {
  for (let offset = start; offset < end; offset += 1) {
    const byte = readByte(bytes, offset);
    const codePoint = decodeSingleByteCodePoint(byte, encoding);

    if (codePoint === undefined) {
      throw createEncodingError({
        code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
        message: "Native backend source map referenced an unmapped single-byte value.",
        byteRange: {
          start: offset,
          end: offset + 1,
        },
        details: {
          backend: "native",
          encoding,
        },
      });
    }

    writer.appendCodeUnit(codePoint);
  }
}

function appendUtf8(writer: TextChunkWriter, bytes: Uint8Array, start: number, end: number): void {
  let offset = start;

  while (offset < end) {
    const first = readByte(bytes, offset);

    if (first <= 0x7f) {
      writer.appendCodeUnit(first);
      offset += 1;
      continue;
    }

    if (first <= 0xdf) {
      const second = readByte(bytes, offset + 1);
      writer.appendCodeUnit(((first & 0x1f) << 6) | (second & BYTE_MASK));
      offset += 2;
      continue;
    }

    if (first <= 0xef) {
      const second = readByte(bytes, offset + 1);
      const third = readByte(bytes, offset + 2);
      writer.appendCodeUnit(
        ((first & 0x0f) << 12) | ((second & BYTE_MASK) << 6) | (third & BYTE_MASK),
      );
      offset += 3;
      continue;
    }

    const second = readByte(bytes, offset + 1);
    const third = readByte(bytes, offset + 2);
    const fourth = readByte(bytes, offset + 3);
    const codePoint =
      ((first & 0x07) << 18) |
      ((second & BYTE_MASK) << 12) |
      ((third & BYTE_MASK) << 6) |
      (fourth & BYTE_MASK);
    appendCodePoint(writer, codePoint);
    offset += 4;
  }
}

function appendUtf16(
  writer: TextChunkWriter,
  bytes: Uint8Array,
  start: number,
  end: number,
  byteOrder: Utf16ByteOrder,
): void {
  for (let offset = start; offset < end; offset += 2) {
    writer.appendCodeUnit(readUtf16CodeUnit(bytes, offset, byteOrder));
  }
}

function appendCodePoint(writer: TextChunkWriter, codePoint: number): void {
  if (codePoint <= 0xffff) {
    writer.appendCodeUnit(codePoint);
    return;
  }

  const adjusted = codePoint - SURROGATE_OFFSET;
  writer.appendCodeUnit(HIGH_SURROGATE_BASE + (adjusted >> SURROGATE_SHIFT));
  writer.appendCodeUnit(LOW_SURROGATE_BASE + (adjusted & SURROGATE_MASK));
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
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Native backend source map referenced bytes outside the input.",
      byteRange: {
        start: offset,
        end: offset,
      },
      details: {
        backend: "native",
        byteLength: bytes.byteLength,
      },
    });
  }

  return byte;
}

function normalizeDecodeOptions(options: BackendDecodeOptions): NormalizedNativeDecodeOptions {
  assertOptionsObject(options);

  const encoding = normalizeNativeDecoderEncoding(options.encoding);
  const decodingPolicy = normalizeControlledDecodingPolicy({
    replacementPolicy: options.replacementPolicy,
    replacementCharacter: options.replacementCharacter,
    errorDetails: {
      backend: "native",
      encoding,
    },
  });

  return Object.freeze({
    encoding,
    stripBom: normalizeBoolean(options.stripBom, "stripBom"),
    sourceMap: normalizeSourceMap(options.sourceMap),
    replacementPolicy: decodingPolicy.replacementPolicy,
    replacementCharacter: decodingPolicy.replacementCharacter,
  });
}

function normalizeEncodeOptions(
  encoding: RmemEncodingName,
  options: EncodeOptions | undefined,
): NormalizedNativeEncodeOptions {
  const normalizedEncoding = normalizeNativeEncoderEncoding(encoding);

  assertEncodeOptionsObject(options);

  const encodeOptions = options ?? {};
  const encodingPolicy = normalizeControlledEncodingPolicy({
    replacementPolicy: encodeOptions.replacementPolicy,
    replacementCharacter: encodeOptions.replacementCharacter,
    errorDetails: {
      backend: "native",
      encoding: normalizedEncoding,
    },
  });

  return Object.freeze({
    encoding: normalizedEncoding,
    replacementPolicy: encodingPolicy.replacementPolicy,
    replacementCharacter: encodingPolicy.replacementCharacter,
  });
}

function normalizeNativeDecoderEncoding(encoding: unknown): NativeDecoderEncodingName {
  if (!isNativeDecoderEncoding(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend cannot decode the requested encoding.",
      details: {
        backend: "native",
        encoding,
        supportedEncodings: NATIVE_DECODER_ENCODINGS,
      },
    });
  }

  return encoding;
}

function normalizeNativeEncoderEncoding(encoding: unknown): NativeDecoderEncodingName {
  if (!isNativeDecoderEncoding(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend cannot encode the requested encoding.",
      details: {
        backend: "native",
        encoding,
        supportedEncodings: NATIVE_DECODER_ENCODINGS,
      },
    });
  }

  return encoding;
}

function normalizeBoolean(value: unknown, option: string): boolean {
  if (typeof value !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend requires normalized boolean options.",
      details: {
        backend: "native",
        option,
        valueType: typeof value,
      },
    });
  }

  return value;
}

function normalizeSourceMap(sourceMap: unknown): SourceMapMode {
  if (sourceMap !== "exact" && sourceMap !== "line" && sourceMap !== "none") {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Native backend requires a valid source map mode.",
      details: {
        backend: "native",
        sourceMap,
      },
    });
  }

  return sourceMap;
}

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend input must be a Uint8Array.",
      details: {
        backend: "native",
        valueType: typeof input,
      },
    });
  }
}

function assertStringInput(input: unknown): asserts input is string {
  if (typeof input !== "string") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend encode input must be a string.",
      details: {
        backend: "native",
        valueType: typeof input,
      },
    });
  }
}

function assertOptionsObject(options: unknown): asserts options is BackendDecodeOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend decode options must be an object.",
      details: {
        backend: "native",
        valueType: typeof options,
      },
    });
  }
}

function assertEncodeOptionsObject(options: unknown): asserts options is EncodeOptions | undefined {
  if (options === undefined) {
    return;
  }

  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native backend encode options must be an object.",
      details: {
        backend: "native",
        valueType: typeof options,
      },
    });
  }
}

function isNativeUnicodeEncoding(value: unknown): value is NativeUnicodeEncodingName {
  return (
    typeof value === "string" &&
    NATIVE_UNICODE_ENCODINGS.includes(value as NativeUnicodeEncodingName)
  );
}

function isNativeDecoderEncoding(value: unknown): value is NativeDecoderEncodingName {
  return (
    typeof value === "string" &&
    NATIVE_DECODER_ENCODINGS.includes(value as NativeDecoderEncodingName)
  );
}

function freezeDecodeResult(options: {
  readonly text: string;
  readonly warnings: readonly EncodingWarning[];
  readonly offsetMap?: OffsetMap;
  readonly offsetMapSegments?: readonly OffsetMapSegment[];
}): BackendDecodeResult {
  return Object.freeze({
    text: options.text,
    warnings: freezeEncodingWarnings(options.warnings),
    ...optionalProperty("offsetMap", options.offsetMap),
    ...optionalProperty("offsetMapSegments", options.offsetMapSegments),
  });
}

function freezeEncodeResult(options: {
  readonly bytes: Uint8Array;
  readonly warnings: readonly EncodingWarning[];
}): EncodeResult {
  return Object.freeze({
    bytes: new Uint8Array(options.bytes),
    warnings: freezeEncodingWarnings(options.warnings),
  });
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}

function sourceMapOutput(
  sourceMap: SourceMapMode,
  buildResult: OffsetMapBuildResult,
): {
  readonly offsetMap?: OffsetMap;
  readonly offsetMapSegments?: readonly OffsetMapSegment[];
} {
  if (sourceMap === "none") {
    return {};
  }

  return {
    offsetMap: buildResult.offsetMap,
    offsetMapSegments: buildResult.segments,
  };
}

class ByteWriter {
  private readonly bytes: number[] = [];

  appendByte(byte: number): void {
    this.bytes.push(byte & 0xff);
  }

  appendBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.appendByte(byte);
    }
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class TextChunkWriter {
  private readonly chunks: string[] = [];
  private codeUnits: number[] = [];

  appendCodeUnit(codeUnit: number): void {
    this.codeUnits.push(codeUnit);

    if (this.codeUnits.length >= TEXT_CHUNK_CODE_UNITS) {
      this.flushCodeUnits();
    }
  }

  appendString(value: string): void {
    if (value.length === 0) {
      return;
    }

    this.flushCodeUnits();
    this.chunks.push(value);
  }

  finish(): string {
    this.flushCodeUnits();
    return this.chunks.join("");
  }

  private flushCodeUnits(): void {
    if (this.codeUnits.length === 0) {
      return;
    }

    this.chunks.push(String.fromCharCode(...this.codeUnits));
    this.codeUnits = [];
  }
}
