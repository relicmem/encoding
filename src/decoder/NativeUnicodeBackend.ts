import type {
  BackendDecodeOptions,
  BackendDecodeResult,
  DecoderBackend,
  DecoderBackendInfo,
  EncodeOptions,
  EncodeResult,
} from "../contracts/backend.js";
import { createEncodingError, freezeEncodingWarnings } from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type { ReplacementPolicy, RmemEncodingName, SourceMapMode } from "../contracts/encoding.js";
import type { OffsetMap, OffsetMapSegment } from "../contracts/source.js";
import { buildExactOffsetMap } from "../source/OffsetMapBuilder.js";
import type { OffsetMapBuildResult } from "../source/OffsetMapBuilder.js";

const NATIVE_UNICODE_ENCODINGS = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
] as const satisfies readonly RmemEncodingName[]);
const DEFAULT_REPLACEMENT_CHARACTER = "\uFFFD";
const BYTE_MASK = 0x3f;
const HIGH_SURROGATE_BASE = 0xd800;
const LOW_SURROGATE_BASE = 0xdc00;
const SURROGATE_OFFSET = 0x10000;
const SURROGATE_SHIFT = 10;
const TEXT_CHUNK_CODE_UNITS = 8192;

type NativeUnicodeEncodingName = (typeof NATIVE_UNICODE_ENCODINGS)[number];
type Utf16ByteOrder = "le" | "be";

interface NormalizedNativeDecodeOptions {
  readonly encoding: NativeUnicodeEncodingName;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

export class NativeUnicodeBackend implements DecoderBackend {
  readonly info: DecoderBackendInfo = Object.freeze({
    name: "native",
    version: "unicode-v1",
    exactSourceMap: true,
  });

  constructor() {
    Object.freeze(this);
  }

  canDecode(encoding: RmemEncodingName): boolean {
    return isNativeUnicodeEncoding(encoding);
  }

  canEncode(encoding: RmemEncodingName): boolean {
    void encoding;

    return false;
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
      warnings: mapResult.value.warnings,
      ...sourceMapOutput(normalizedOptions.sourceMap, mapResult.value),
    });
  }

  encode(input: string, encoding: RmemEncodingName, options?: EncodeOptions): EncodeResult {
    void input;
    void options;

    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend encode support is not implemented.",
      details: {
        backend: "native",
        encoding,
      },
    });
  }
}

export const NATIVE_UNICODE_BACKEND: NativeUnicodeBackend = new NativeUnicodeBackend();

export function createNativeUnicodeBackend(): NativeUnicodeBackend {
  return new NativeUnicodeBackend();
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
      message: "Native Unicode backend produced text that does not match its source map.",
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
      appendAscii(writer, bytes, segment.byteRange.start, segment.byteRange.end);
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
        message: "Native Unicode backend cannot decode synthetic offset map segments.",
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
  encoding: NativeUnicodeEncodingName,
): void {
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

function appendAscii(writer: TextChunkWriter, bytes: Uint8Array, start: number, end: number): void {
  for (let offset = start; offset < end; offset += 1) {
    writer.appendCodeUnit(readByte(bytes, offset));
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
  writer.appendCodeUnit(LOW_SURROGATE_BASE + (adjusted & 0x3ff));
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
      message: "Native Unicode backend source map referenced bytes outside the input.",
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

  const encoding = normalizeNativeUnicodeEncoding(options.encoding);

  return Object.freeze({
    encoding,
    stripBom: normalizeBoolean(options.stripBom, "stripBom"),
    sourceMap: normalizeSourceMap(options.sourceMap),
    replacementPolicy: normalizeReplacementPolicy(options.replacementPolicy),
    replacementCharacter: normalizeReplacementCharacter(options.replacementCharacter),
  });
}

function normalizeNativeUnicodeEncoding(encoding: unknown): NativeUnicodeEncodingName {
  if (!isNativeUnicodeEncoding(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend cannot decode the requested encoding.",
      details: {
        backend: "native",
        encoding,
        supportedEncodings: NATIVE_UNICODE_ENCODINGS,
      },
    });
  }

  return encoding;
}

function normalizeBoolean(value: unknown, option: string): boolean {
  if (typeof value !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend requires normalized boolean options.",
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
      message: "Native Unicode backend requires a valid source map mode.",
      details: {
        backend: "native",
        sourceMap,
      },
    });
  }

  return sourceMap;
}

function normalizeReplacementPolicy(policy: unknown): ReplacementPolicy {
  if (policy !== "fatal" && policy !== "replace") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend requires a valid replacement policy.",
      details: {
        backend: "native",
        replacementPolicy: policy,
      },
    });
  }

  return policy;
}

function normalizeReplacementCharacter(replacementCharacter: unknown): string {
  if (replacementCharacter === undefined) {
    return DEFAULT_REPLACEMENT_CHARACTER;
  }

  if (typeof replacementCharacter !== "string" || replacementCharacter.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend requires a non-empty replacement character.",
      details: {
        backend: "native",
        valueType: typeof replacementCharacter,
        length: typeof replacementCharacter === "string" ? replacementCharacter.length : undefined,
      },
    });
  }

  return replacementCharacter;
}

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Native Unicode backend input must be a Uint8Array.",
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
      message: "Native Unicode backend decode options must be an object.",
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
