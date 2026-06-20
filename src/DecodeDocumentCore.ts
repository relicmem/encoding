import type {
  BackendDecodeResult,
  DecoderBackend,
  DecoderBackendInfo,
} from "./contracts/backend.js";
import {
  createEncodingError,
  isEncodingError,
  mergeEncodingWarnings,
} from "./contracts/diagnostics.js";
import type { EncodingError, EncodingWarning } from "./contracts/diagnostics.js";
import type { EncodingDetectionResult } from "./contracts/detection.js";
import type { DecodedDocument } from "./contracts/document.js";
import type { OffsetMap, OffsetMapSegment } from "./contracts/source.js";
import {
  NATIVE_UNICODE_BACKEND,
  createDecoderRegistry,
  createTextDecoderBackend,
  isTextDecoderBackendAvailable,
} from "./decoder/index.js";
import type { DecoderBackendSelection } from "./decoder/index.js";
import { detectNormalizedCompositeEncoding } from "./detector/CompositeDetector.js";
import type { NormalizedDecodeDocumentOptions } from "./encoding/OptionsNormalization.js";
import { createDecodedDocument } from "./source/DecodedDocument.js";
import { createDecodedStringDocument, createOffsetMap } from "./source/index.js";
import type {
  NormalizedByteInput,
  NormalizedEncodingInput,
  NormalizedStringInput,
} from "./source/index.js";

export const DEFAULT_DECODER_REGISTRY = createDecoderRegistry(createDefaultDecoderBackends());

export function decodeNormalizedDocument(
  input: NormalizedEncodingInput,
  options: NormalizedDecodeDocumentOptions,
): DecodedDocument {
  if (input.kind === "string") {
    return decodeStringInput(input, options);
  }

  return decodeByteInput(input, options);
}

function decodeStringInput(
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

function decodeByteInput(
  input: NormalizedByteInput,
  options: NormalizedDecodeDocumentOptions,
): DecodedDocument {
  const source = input.source;
  const bytes = source.bytes;
  const detection = detectNormalizedCompositeEncoding(bytes, options);
  const backendSelection = withFatalWarnings(
    () => selectDocumentDecoderBackend(detection, options),
    detection.warnings,
  );
  const backendResult = withFatalWarnings(
    () =>
      backendSelection.backend.decode(bytes, {
        encoding: detection.encoding,
        stripBom: options.stripBom,
        sourceMap: options.sourceMap,
        replacementPolicy: options.replacementPolicy,
        replacementCharacter: options.replacementCharacter,
      }),
    detection.warnings,
    backendSelection.warnings,
  );
  const offsetMap = withFatalWarnings(
    () =>
      resolveDocumentOffsetMap({
        backendResult,
        backendInfo: backendSelection.info,
        sourceMap: options.sourceMap,
        byteLength: source.byteLength,
        textLength: backendResult.text.length,
      }),
    detection.warnings,
    backendSelection.warnings,
    backendResult.warnings,
  );

  return withFatalWarnings(
    () =>
      createDecodedDocument({
        text: backendResult.text,
        source,
        detection,
        backend: backendSelection.info,
        offsetMap,
        warnings: {
          backend: backendSelection.warnings,
          sourceMap: backendResult.warnings,
        },
      }),
    detection.warnings,
    backendSelection.warnings,
    backendResult.warnings,
  );
}

export function selectDocumentDecoderBackend(
  detection: EncodingDetectionResult,
  options: NormalizedDecodeDocumentOptions,
): DecoderBackendSelection {
  return DEFAULT_DECODER_REGISTRY.selectDecoderBackend({
    encoding: detection.encoding,
    profile: options.profile,
    sourceMap: options.sourceMap,
    backendPreference: options.backendPreference,
  });
}

export function resolveDocumentOffsetMap(options: {
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

function createDefaultDecoderBackends(): readonly DecoderBackend[] {
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

function withFatalWarnings<TValue>(
  operation: () => TValue,
  ...warningGroups: readonly (readonly EncodingWarning[] | undefined)[]
): TValue {
  try {
    return operation();
  } catch (error) {
    if (isEncodingError(error)) {
      throw enrichEncodingErrorWarnings(error, ...warningGroups);
    }

    throw error;
  }
}

function enrichEncodingErrorWarnings(
  error: EncodingError,
  ...warningGroups: readonly (readonly EncodingWarning[] | undefined)[]
): EncodingError {
  return createEncodingError({
    code: error.code,
    message: error.message,
    ...optionalProperty("byteRange", error.byteRange),
    ...optionalProperty("textRange", error.textRange),
    ...optionalProperty("details", error.details),
    warnings: mergeEncodingWarnings(...warningGroups, error.warnings),
    ...optionalProperty("cause", encodingErrorCause(error)),
  });
}

function encodingErrorCause(error: EncodingError): unknown {
  return Object.prototype.hasOwnProperty.call(error, "cause")
    ? (error as { readonly cause?: unknown }).cause
    : undefined;
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
