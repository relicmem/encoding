import type {
  BackendDecodeResult,
  DecoderBackend,
  DecoderBackendInfo,
} from "./contracts/backend.js";
import type { EncodingDetectionResult, NormalizedEncodingLabel } from "./contracts/detection.js";
import { createEncodingError, mergeEncodingWarnings } from "./contracts/diagnostics.js";
import type { EncodingWarning } from "./contracts/diagnostics.js";
import type { DecodeDocumentOptions, SyncEncodingInput } from "./contracts/encoding.js";
import type { DecodedDocument } from "./contracts/document.js";
import type { OffsetMap, OffsetMapSegment, SourceBuffer } from "./contracts/source.js";
import {
  NATIVE_UNICODE_BACKEND,
  createDecoderRegistry,
  createTextDecoderBackend,
  isTextDecoderBackendAvailable,
} from "./decoder/index.js";
import { detectCompositeEncoding } from "./detector/CompositeDetector.js";
import {
  normalizeDecodeDocumentOptions,
  type NormalizedDecodeDocumentOptions,
} from "./encoding/OptionsNormalization.js";
import {
  createDecodedStringDocument,
  createLineIndex,
  createOffsetMap,
  normalizeEncodingInputSync,
} from "./source/index.js";
import type { NormalizedByteInput, NormalizedStringInput } from "./source/index.js";

const DEFAULT_SYNC_DECODER_REGISTRY = createDecoderRegistry(createDefaultSyncDecoderBackends());

export function decodeDocumentSync(
  input: SyncEncodingInput,
  options?: DecodeDocumentOptions,
): DecodedDocument {
  const normalizedOptions = normalizeDecodeDocumentOptions(options);
  const normalizedInput = normalizeEncodingInputSync(input);

  if (normalizedInput.kind === "string") {
    return decodeStringInputSync(normalizedInput, normalizedOptions);
  }

  return decodeByteInputSync(normalizedInput, normalizedOptions, options);
}

function decodeStringInputSync(
  input: NormalizedStringInput,
  options: NormalizedDecodeDocumentOptions,
): DecodedDocument {
  return createDecodedStringDocument(input.text, {
    profile: options.profile,
    defaultEncoding: options.defaultEncoding.canonical,
    sourceMap: options.sourceMap,
    ...optionalProperty("explicitEncoding", inputLabelForDetection(options.explicitEncoding)),
  });
}

function decodeByteInputSync(
  input: NormalizedByteInput,
  options: NormalizedDecodeDocumentOptions,
  originalOptions: DecodeDocumentOptions | undefined,
): DecodedDocument {
  const source = input.source;
  const bytes = source.bytes;
  const detection = detectCompositeEncoding(bytes, originalOptions);
  const backendSelection = DEFAULT_SYNC_DECODER_REGISTRY.selectDecoderBackend({
    encoding: detection.encoding,
    profile: options.profile,
    sourceMap: options.sourceMap,
    backendPreference: options.backendPreference,
  });
  const backendResult = backendSelection.backend.decode(bytes, {
    encoding: detection.encoding,
    stripBom: options.stripBom,
    sourceMap: options.sourceMap,
    replacementPolicy: options.replacementPolicy,
    replacementCharacter: options.replacementCharacter,
  });
  const offsetMap = resolveDocumentOffsetMap({
    backendResult,
    backendInfo: backendSelection.info,
    sourceMap: options.sourceMap,
    byteLength: source.byteLength,
    textLength: backendResult.text.length,
  });

  return createDecodedDocument({
    text: backendResult.text,
    source,
    detection: attachSelectedBackend(detection, backendSelection.info),
    offsetMap,
    warnings: mergeEncodingWarnings(
      detection.warnings,
      backendSelection.warnings,
      backendResult.warnings,
    ),
  });
}

function resolveDocumentOffsetMap(options: {
  readonly backendResult: BackendDecodeResult;
  readonly backendInfo: DecoderBackendInfo;
  readonly sourceMap: NormalizedDecodeDocumentOptions["sourceMap"];
  readonly byteLength: number;
  readonly textLength: number;
}): OffsetMap {
  const offsetMap =
    options.backendResult.offsetMap ??
    offsetMapFromSegments(options.backendResult.offsetMapSegments);

  if (offsetMap !== undefined) {
    assertOffsetMapCoversDocument(offsetMap, options);
    return offsetMap;
  }

  if (options.sourceMap === "none") {
    return createSourceMapDisabledOffsetMap(options.byteLength, options.textLength);
  }

  throw createEncodingError({
    code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
    message: "Decoder backend did not provide the requested source map.",
    details: {
      backend: options.backendInfo.name,
      sourceMap: options.sourceMap,
      byteLength: options.byteLength,
      textLength: options.textLength,
    },
  });
}

function offsetMapFromSegments(
  segments: readonly OffsetMapSegment[] | undefined,
): OffsetMap | undefined {
  return segments === undefined ? undefined : createOffsetMap(segments);
}

function assertOffsetMapCoversDocument(
  offsetMap: OffsetMap,
  options: {
    readonly backendInfo: DecoderBackendInfo;
    readonly sourceMap: NormalizedDecodeDocumentOptions["sourceMap"];
    readonly byteLength: number;
    readonly textLength: number;
  },
): void {
  const segments = offsetMap.segments();
  const lastSegment = segments.at(-1);
  const mappedByteLength = lastSegment?.byteRange.end ?? 0;
  const mappedTextLength = lastSegment?.textRange.end ?? 0;

  if (mappedByteLength === options.byteLength && mappedTextLength === options.textLength) {
    return;
  }

  throw createEncodingError({
    code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
    message: "Decoder backend produced a source map that does not cover the decoded document.",
    details: {
      backend: options.backendInfo.name,
      sourceMap: options.sourceMap,
      byteLength: options.byteLength,
      textLength: options.textLength,
      mappedByteLength,
      mappedTextLength,
    },
  });
}

function createSourceMapDisabledOffsetMap(byteLength: number, textLength: number): OffsetMap {
  if (byteLength === 0 && textLength === 0) {
    return createOffsetMap([]);
  }

  return createOffsetMap([
    {
      byteRange: {
        start: 0,
        end: byteLength,
      },
      textRange: {
        start: 0,
        end: textLength,
      },
      kind: "encoded",
    },
  ]);
}

function createDecodedDocument(parts: {
  readonly text: string;
  readonly source: SourceBuffer;
  readonly detection: EncodingDetectionResult;
  readonly offsetMap: OffsetMap;
  readonly warnings: readonly EncodingWarning[];
}): DecodedDocument {
  const warnings = mergeEncodingWarnings(parts.warnings);
  const lineIndex = createLineIndex(parts.text, parts.offsetMap);

  return Object.freeze({
    text: parts.text,
    get bytes(): Uint8Array {
      return parts.source.bytes;
    },
    detection: parts.detection,
    lineIndex,
    offsetMap: parts.offsetMap,
    warnings,
    source: parts.source,
  });
}

function attachSelectedBackend(
  detection: EncodingDetectionResult,
  backendInfo: DecoderBackendInfo,
): EncodingDetectionResult {
  return Object.freeze({
    encoding: detection.encoding,
    confidence: detection.confidence,
    source: detection.source,
    bomLength: detection.bomLength,
    candidates: Object.freeze([...detection.candidates]),
    warnings: mergeEncodingWarnings(detection.warnings),
    label: freezeNormalizedEncodingLabel(detection.label),
    backend: freezeDecoderBackendInfo(backendInfo),
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

function createDefaultSyncDecoderBackends(): readonly DecoderBackend[] {
  const backends: DecoderBackend[] = [NATIVE_UNICODE_BACKEND];

  if (isTextDecoderBackendAvailable()) {
    backends.push(createTextDecoderBackend());
  }

  return Object.freeze(backends);
}

function inputLabelForDetection(
  label: NormalizedDecodeDocumentOptions["explicitEncoding"],
): string | undefined {
  return label === undefined ? undefined : (label.inputLabel ?? label.canonical);
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
