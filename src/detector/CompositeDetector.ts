import type { DecoderBackendInfo } from "../contracts/backend.js";
import type {
  EncodingCandidate,
  EncodingDetectionSource,
  EncodingDetectionResult,
  NormalizedEncodingLabel,
} from "../contracts/detection.js";
import {
  createEncodingError,
  createEncodingWarning,
  encodingFailure,
  encodingSuccess,
  isEncodingError,
  mergeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingResult, EncodingWarning } from "../contracts/diagnostics.js";
import type { DetectEncodingOptions, RelicMEMEncodingName } from "../contracts/encoding.js";
import { aliasesForEncoding } from "../encoding/EncodingRegistry.js";
import { normalizeDetectEncodingOptions } from "../encoding/OptionsNormalization.js";
import type { NormalizedDetectEncodingOptions } from "../encoding/OptionsNormalization.js";
import { sniffEncodingMetadata } from "../encoding/MetadataSniffing.js";
import type { EncodingMetadataSniffingResult } from "../encoding/MetadataSniffing.js";
import type { EncodingByteOrderMark } from "./BomDetector.js";
import { detectByteOrderMark } from "./BomDetector.js";
import type { LegacyEncodingDetectionResult } from "./LegacyDetector.js";
import { detectLegacyEncoding } from "./LegacyDetector.js";
import type { Utf16DetectionResult } from "./Utf16Detector.js";
import { detectUtf16 } from "./Utf16Detector.js";
import type { Utf8ValidationResult } from "./Utf8Validator.js";
import { validateUtf8 } from "./Utf8Validator.js";
import {
  createEncodingCandidate,
  createFallbackEncodingCandidate,
  resolveEncodingCandidateDecision,
} from "./ConfidencePolicy.js";

export interface CompositeDetectionInputSample {
  readonly bytes: Uint8Array;
  readonly sampledByteLength: number;
  readonly originalByteLength: number;
  readonly truncated: boolean;
  readonly inputComplete: boolean;
}

const DETECTION_BACKEND_PLACEHOLDER = Object.freeze({
  name: "native",
  exactSourceMap: false,
} as const satisfies DecoderBackendInfo);
const SAMPLE_LIMITED_CONFIDENCE_CAP = 0.99;
const SAMPLE_LIMITED_CONFIDENCE_SOURCES = Object.freeze([
  "utf8-validation",
  "utf16-heuristic",
  "heuristic",
] as const satisfies readonly EncodingDetectionSource[]);

export function detectCompositeEncoding(
  input: Uint8Array,
  options?: DetectEncodingOptions,
): EncodingDetectionResult {
  assertByteInput(input);

  const normalizedOptions = normalizeDetectEncodingOptions(options);

  return detectNormalizedCompositeEncoding(input, normalizedOptions);
}

export function detectNormalizedCompositeEncoding(
  input: Uint8Array,
  normalizedOptions: NormalizedDetectEncodingOptions,
): EncodingDetectionResult {
  assertByteInput(input);

  const sample = createCompositeDetectionInputSample(input, normalizedOptions.sampleSizeBytes);

  return detectNormalizedCompositeEncodingFromSample(sample, normalizedOptions);
}

export function detectNormalizedCompositeEncodingFromSample(
  sample: CompositeDetectionInputSample,
  normalizedOptions: NormalizedDetectEncodingOptions,
): EncodingDetectionResult {
  assertCompositeDetectionInputSample(sample);

  const explicitCandidate = createExplicitCandidate(normalizedOptions.explicitEncoding);
  const bomResult = detectByteOrderMark(sample.bytes, {
    allowedEncodings: normalizedOptions.allowedEncodings,
    ...optionalProperty("explicitEncoding", normalizedOptions.explicitEncoding),
    conflictPolicy: resolveBomConflictPolicy(normalizedOptions),
  });
  const metadataResult = sniffEncodingMetadata({
    profile: normalizedOptions.profile,
    allowedEncodings: normalizedOptions.allowedEncodings,
    ...optionalProperty("metadata", normalizedOptions.metadata),
    ...optionalProperty("explicitEncoding", normalizedOptions.explicitEncoding),
    ...optionalProperty("bom", bomMetadataSignal(bomResult.bom)),
  });
  const utf8Result = validateUtf8(sample.bytes, {
    allowedEncodings: normalizedOptions.allowedEncodings,
    ...optionalProperty(
      "higherPrioritySource",
      utf8HigherPrioritySource(normalizedOptions, bomResult.bom),
    ),
    invalidPolicy: resolveUtf8InvalidPolicy(normalizedOptions),
  });
  const utf16Result = detectUtf16ForComposite(
    sample.bytes,
    normalizedOptions,
    bomResult.bom,
    utf8Result,
  );
  const legacyResult = detectLegacyForComposite(
    sample.bytes,
    normalizedOptions,
    bomResult.bom,
    utf8Result,
  );
  const hasHigherPriorityCandidate =
    explicitCandidate !== undefined ||
    bomResult.candidate !== undefined ||
    metadataResult.candidate !== undefined;
  const sampleLimited = shouldApplySampleLimitWarning(sample, hasHigherPriorityCandidate);
  const warnings = mergeEncodingWarnings(
    bomResult.warnings,
    metadataResult.warnings,
    utf8Result.warnings,
    utf16Result.warnings,
    legacyResult.warnings,
    sampleLimited ? [createTruncatedSampleWarning(sample)] : [],
  );
  const decision = resolveEncodingCandidateDecision({
    candidates: applySampleLimitedConfidenceCap(
      collectCompositeCandidates({
        explicitCandidate,
        bomCandidate: bomResult.candidate,
        metadataCandidate: metadataResult.candidate,
        utf8Candidate: utf8Result.candidate,
        utf16Candidates: utf16Result.candidates,
        legacyCandidates: legacyResult.candidates,
      }),
      sampleLimited,
    ),
    fallbackCandidate: createFallbackEncodingCandidate({
      encoding: normalizedOptions.defaultEncoding.canonical,
    }),
    minConfidence: normalizedOptions.minConfidence,
    warnings,
    ambiguousSources: [],
  });
  const selectedCandidate = decision.selectedCandidate;

  return createCompositeDetectionResult({
    selectedCandidate,
    candidates: decision.candidates,
    warnings: decision.warnings,
    bom: bomResult.bom,
    label: labelForSelectedCandidate(selectedCandidate, {
      normalizedOptions,
      bom: bomResult.bom,
      metadataResult,
    }),
  });
}

export function tryDetectCompositeEncoding(
  input: Uint8Array,
  options?: DetectEncodingOptions,
): EncodingResult<EncodingDetectionResult> {
  try {
    return encodingSuccess(detectCompositeEncoding(input, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

export function createCompositeDetectionInputSample(
  input: Uint8Array,
  sampleSizeBytes: number,
): CompositeDetectionInputSample {
  const sampledByteLength = Math.min(input.byteLength, sampleSizeBytes);

  return createCompositeDetectionInputSampleSnapshot({
    bytes: input.subarray(0, sampledByteLength),
    sampledByteLength,
    originalByteLength: input.byteLength,
    inputComplete: true,
  });
}

export function createCompositeDetectionInputSampleSnapshot(options: {
  readonly bytes: Uint8Array;
  readonly sampledByteLength: number;
  readonly originalByteLength: number;
  readonly inputComplete: boolean;
}): CompositeDetectionInputSample {
  assertByteInput(options.bytes);
  assertNonNegativeSafeInteger(options.sampledByteLength, "sampledByteLength");
  assertNonNegativeSafeInteger(options.originalByteLength, "originalByteLength");

  if (options.bytes.byteLength !== options.sampledByteLength) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample byte length must match the sampled byte length.",
      details: {
        byteLength: options.bytes.byteLength,
        sampledByteLength: options.sampledByteLength,
      },
    });
  }

  if (options.sampledByteLength > options.originalByteLength) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample cannot be longer than the original byte length.",
      details: {
        sampledByteLength: options.sampledByteLength,
        originalByteLength: options.originalByteLength,
      },
    });
  }

  if (typeof options.inputComplete !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample inputComplete flag must be a boolean.",
      details: {
        inputComplete: options.inputComplete,
      },
    });
  }

  return Object.freeze({
    bytes: options.bytes,
    sampledByteLength: options.sampledByteLength,
    originalByteLength: options.originalByteLength,
    truncated: options.sampledByteLength < options.originalByteLength,
    inputComplete: options.inputComplete,
  });
}

function createExplicitCandidate(
  explicitEncoding: NormalizedEncodingLabel | undefined,
): EncodingCandidate | undefined {
  if (explicitEncoding === undefined) {
    return undefined;
  }

  return createEncodingCandidate({
    encoding: explicitEncoding.canonical,
    confidence: 1,
    source: "explicit",
    reason: "Explicit encoding label from options.",
    bomLength: 0,
  });
}

function detectUtf16ForComposite(
  input: Uint8Array,
  options: NormalizedDetectEncodingOptions,
  bom: EncodingByteOrderMark | undefined,
  utf8Validation: Utf8ValidationResult,
): Utf16DetectionResult {
  if (options.explicitEncoding !== undefined || bom !== undefined) {
    return emptyUtf16DetectionResult();
  }

  if (utf8Validation.valid && !containsNulByte(input)) {
    return emptyUtf16DetectionResult();
  }

  return detectUtf16(input, {
    profile: options.profile,
    allowedEncodings: options.allowedEncodings,
    minConfidence: 0,
  });
}

function detectLegacyForComposite(
  input: Uint8Array,
  options: NormalizedDetectEncodingOptions,
  bom: EncodingByteOrderMark | undefined,
  utf8Validation: Utf8ValidationResult,
): LegacyEncodingDetectionResult {
  if (options.explicitEncoding !== undefined || bom !== undefined) {
    return emptyLegacyDetectionResult();
  }

  return detectLegacyEncoding(input, {
    profile: options.profile,
    allowedEncodings: options.allowedEncodings,
    minConfidence: 0,
    utf8Validation: {
      valid: utf8Validation.valid,
    },
  });
}

function collectCompositeCandidates(options: {
  readonly explicitCandidate: EncodingCandidate | undefined;
  readonly bomCandidate: EncodingCandidate | undefined;
  readonly metadataCandidate: EncodingCandidate | undefined;
  readonly utf8Candidate: EncodingCandidate | undefined;
  readonly utf16Candidates: readonly EncodingCandidate[];
  readonly legacyCandidates: readonly EncodingCandidate[];
}): readonly EncodingCandidate[] {
  return [
    ...definedCandidate(options.explicitCandidate),
    ...definedCandidate(options.bomCandidate),
    ...definedCandidate(options.metadataCandidate),
    ...definedCandidate(options.utf8Candidate),
    ...options.utf16Candidates,
    ...options.legacyCandidates,
  ];
}

function applySampleLimitedConfidenceCap(
  candidates: readonly EncodingCandidate[],
  sampleLimited: boolean,
): readonly EncodingCandidate[] {
  if (!sampleLimited) {
    return candidates;
  }

  return Object.freeze(
    candidates.map((candidate) => {
      if (
        !isSampleLimitedConfidenceSource(candidate.source) ||
        candidate.confidence <= SAMPLE_LIMITED_CONFIDENCE_CAP
      ) {
        return candidate;
      }

      return createEncodingCandidate({
        encoding: candidate.encoding,
        confidence: SAMPLE_LIMITED_CONFIDENCE_CAP,
        source: candidate.source,
        reason: `${candidate.reason} Confidence was capped because detection used a bounded byte sample.`,
        bomLength: candidate.bomLength,
      });
    }),
  );
}

function isSampleLimitedConfidenceSource(source: EncodingDetectionSource): boolean {
  return SAMPLE_LIMITED_CONFIDENCE_SOURCES.includes(
    source as (typeof SAMPLE_LIMITED_CONFIDENCE_SOURCES)[number],
  );
}

function shouldApplySampleLimitWarning(
  sample: CompositeDetectionInputSample,
  hasHigherPriorityCandidate: boolean,
): boolean {
  return !hasHigherPriorityCandidate && (sample.truncated || !sample.inputComplete);
}

function createTruncatedSampleWarning(sample: CompositeDetectionInputSample): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_TRUNCATED_SAMPLE",
    message:
      "Detection is based on a bounded byte sample; bytes outside the sample were not validated.",
    details: {
      sampledByteLength: sample.sampledByteLength,
      originalByteLength: sample.originalByteLength,
      inputComplete: sample.inputComplete,
      confidenceCap: SAMPLE_LIMITED_CONFIDENCE_CAP,
    },
  });
}

function labelForSelectedCandidate(
  candidate: EncodingCandidate,
  context: {
    readonly normalizedOptions: NormalizedDetectEncodingOptions;
    readonly bom: EncodingByteOrderMark | undefined;
    readonly metadataResult: EncodingMetadataSniffingResult;
  },
): NormalizedEncodingLabel {
  switch (candidate.source) {
    case "explicit":
      return requiredLabel(
        context.normalizedOptions.explicitEncoding,
        "Explicit candidate requires a normalized explicit label.",
      );
    case "bom":
      return requiredBomLabel(candidate, context.bom);
    case "metadata":
      return requiredMetadataLabel(candidate, context.metadataResult);
    case "fallback":
      return context.normalizedOptions.defaultEncoding;
    case "utf8-validation":
    case "utf16-heuristic":
    case "heuristic":
      return createProfileCanonicalLabel(candidate.encoding, context.normalizedOptions);
    default:
      return unsupportedCandidateSource(candidate.source);
  }
}

function requiredBomLabel(
  candidate: EncodingCandidate,
  bom: EncodingByteOrderMark | undefined,
): NormalizedEncodingLabel {
  if (bom?.encoding === candidate.encoding) {
    return bom.label;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "BOM candidate requires matching BOM metadata.",
    details: {
      candidateEncoding: candidate.encoding,
      bomEncoding: bom?.encoding,
    },
  });
}

function requiredMetadataLabel(
  candidate: EncodingCandidate,
  metadataResult: EncodingMetadataSniffingResult,
): NormalizedEncodingLabel {
  const label = metadataResult.selectedLabel?.label;

  if (label?.canonical === candidate.encoding) {
    return label;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "Metadata candidate requires matching metadata label.",
    details: {
      candidateEncoding: candidate.encoding,
      metadataEncoding: label?.canonical,
    },
  });
}

function requiredLabel(
  label: NormalizedEncodingLabel | undefined,
  message: string,
): NormalizedEncodingLabel {
  if (label !== undefined) {
    return label;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message,
  });
}

function createProfileCanonicalLabel(
  encoding: RelicMEMEncodingName,
  options: NormalizedDetectEncodingOptions,
): NormalizedEncodingLabel {
  return Object.freeze({
    inputLabel: encoding,
    canonical: encoding,
    aliases: aliasesForEncoding(encoding, {
      profile: options.profile,
    }),
    source: "profile",
  });
}

function createCompositeDetectionResult(options: {
  readonly selectedCandidate: EncodingCandidate;
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly label: NormalizedEncodingLabel;
  readonly bom: EncodingByteOrderMark | undefined;
}): EncodingDetectionResult {
  const bomLength = options.bom?.bomLength ?? options.selectedCandidate.bomLength;

  return Object.freeze({
    encoding: options.selectedCandidate.encoding,
    confidence: options.selectedCandidate.confidence,
    source: options.selectedCandidate.source,
    bomLength,
    candidates: Object.freeze([...options.candidates]),
    warnings: mergeEncodingWarnings(options.warnings),
    label: freezeNormalizedEncodingLabel(options.label),
    backend: DETECTION_BACKEND_PLACEHOLDER,
  });
}

function emptyUtf16DetectionResult(): Utf16DetectionResult {
  return Object.freeze({
    candidates: Object.freeze([]),
    warnings: mergeEncodingWarnings(),
  });
}

function emptyLegacyDetectionResult(): LegacyEncodingDetectionResult {
  return Object.freeze({
    candidates: Object.freeze([]),
    warnings: mergeEncodingWarnings(),
  });
}

function bomMetadataSignal(
  bom: EncodingByteOrderMark | undefined,
): EncodingByteOrderMark | undefined {
  return bom;
}

function utf8HigherPrioritySource(
  options: NormalizedDetectEncodingOptions,
  bom: EncodingByteOrderMark | undefined,
): "explicit" | "bom" | undefined {
  if (options.explicitEncoding !== undefined) {
    return "explicit";
  }

  if (bom !== undefined) {
    return "bom";
  }

  return undefined;
}

function resolveBomConflictPolicy(options: NormalizedDetectEncodingOptions): "warning" | "fatal" {
  return options.profile.name === "strictUtf8" ? "fatal" : "warning";
}

function resolveUtf8InvalidPolicy(options: NormalizedDetectEncodingOptions): "collect" | "fatal" {
  return options.profile.name === "strictUtf8" ? "fatal" : "collect";
}

function definedCandidate(candidate: EncodingCandidate | undefined): readonly EncodingCandidate[] {
  return candidate === undefined ? [] : [candidate];
}

function containsNulByte(input: Uint8Array): boolean {
  return input.includes(0);
}

function freezeNormalizedEncodingLabel(label: NormalizedEncodingLabel): NormalizedEncodingLabel {
  return Object.freeze({
    ...optionalProperty("inputLabel", label.inputLabel),
    canonical: label.canonical,
    aliases: Object.freeze([...label.aliases]),
    source: label.source,
  });
}

function unsupportedCandidateSource(source: never): never {
  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "Unsupported selected candidate source.",
    details: {
      source,
    },
  });
}

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Composite detection input must be a Uint8Array.",
      details: {
        inputType: typeof input,
      },
    });
  }
}

function assertCompositeDetectionInputSample(
  sample: CompositeDetectionInputSample,
): asserts sample is CompositeDetectionInputSample {
  assertByteInput(sample.bytes);
  assertNonNegativeSafeInteger(sample.sampledByteLength, "sampledByteLength");
  assertNonNegativeSafeInteger(sample.originalByteLength, "originalByteLength");

  if (sample.bytes.byteLength !== sample.sampledByteLength) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample byte length must match the sampled byte length.",
      details: {
        byteLength: sample.bytes.byteLength,
        sampledByteLength: sample.sampledByteLength,
      },
    });
  }

  if (sample.sampledByteLength > sample.originalByteLength) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample cannot be longer than the original byte length.",
      details: {
        sampledByteLength: sample.sampledByteLength,
        originalByteLength: sample.originalByteLength,
      },
    });
  }

  if (sample.truncated !== sample.sampledByteLength < sample.originalByteLength) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample truncated flag does not match sample lengths.",
      details: {
        sampledByteLength: sample.sampledByteLength,
        originalByteLength: sample.originalByteLength,
        truncated: sample.truncated,
      },
    });
  }

  if (typeof sample.inputComplete !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample inputComplete flag must be a boolean.",
      details: {
        inputComplete: sample.inputComplete,
      },
    });
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Detection sample lengths must be non-negative safe integers.",
      details: {
        option: label,
        value,
      },
    });
  }
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
