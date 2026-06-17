import type { EncodingCandidate, EncodingDetectionSource } from "../contracts/detection.js";
import {
  createEncodingError,
  createEncodingWarning,
  freezeEncodingWarnings,
  mergeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type { RmemEncodingName } from "../contracts/encoding.js";
import { RMEM_ENCODING_NAMES, isRmemEncodingName } from "../encoding/EncodingRegistry.js";

export interface CreateEncodingCandidateOptions {
  readonly encoding: RmemEncodingName;
  readonly confidence: number;
  readonly source: EncodingDetectionSource;
  readonly reason: string;
  readonly bomLength?: number;
}

export interface ResolveEncodingCandidateDecisionOptions {
  readonly candidates: readonly EncodingCandidate[];
  readonly minConfidence: number;
  readonly fallbackCandidate?: EncodingCandidate;
  readonly warnings?: readonly EncodingWarning[];
  readonly ambiguityThreshold?: number;
  readonly ambiguousSources?: readonly EncodingDetectionSource[];
}

export interface EncodingCandidateDecision {
  readonly selectedCandidate: EncodingCandidate;
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
}

export const DEFAULT_AMBIGUITY_THRESHOLD = 0.05;

export const ENCODING_CANDIDATE_SOURCE_PRIORITY = Object.freeze([
  "explicit",
  "bom",
  "metadata",
  "utf8-validation",
  "utf16-heuristic",
  "heuristic",
  "fallback",
] as const satisfies readonly EncodingDetectionSource[]);

const DEFAULT_AMBIGUOUS_SOURCES = Object.freeze([
  "heuristic",
] as const satisfies readonly EncodingDetectionSource[]);

const ENCODING_ORDER = buildPriorityLookup(RMEM_ENCODING_NAMES);
const SOURCE_ORDER = buildPriorityLookup(ENCODING_CANDIDATE_SOURCE_PRIORITY);

export function createEncodingCandidate(
  options: CreateEncodingCandidateOptions,
): EncodingCandidate {
  assertCandidateEncoding(options.encoding);
  assertConfidenceScore(options.confidence, "candidate.confidence");
  assertDetectionSource(options.source, "candidate.source");
  assertNonEmptyReason(options.reason);
  const bomLength = normalizeBomLength(options.bomLength);

  return freezeEncodingCandidate({
    encoding: options.encoding,
    confidence: options.confidence,
    source: options.source,
    reason: options.reason,
    bomLength,
  });
}

export function createFallbackEncodingCandidate(options: {
  readonly encoding: RmemEncodingName;
  readonly confidence?: number;
  readonly reason?: string;
}): EncodingCandidate {
  return createEncodingCandidate({
    encoding: options.encoding,
    confidence: options.confidence ?? 0,
    source: "fallback",
    reason:
      options.reason ??
      "Default encoding fallback was used because detection found no stronger signal.",
    bomLength: 0,
  });
}

export function sortEncodingCandidates(
  candidates: readonly EncodingCandidate[],
): readonly EncodingCandidate[] {
  return Object.freeze(deduplicateCandidates(candidates).sort(compareEncodingCandidates));
}

export function resolveEncodingCandidateDecision(
  options: ResolveEncodingCandidateDecisionOptions,
): EncodingCandidateDecision {
  const minConfidence = normalizeMinConfidence(options.minConfidence);
  const ambiguityThreshold = normalizeAmbiguityThreshold(options.ambiguityThreshold);
  const ambiguousSources = normalizeAmbiguousSources(options.ambiguousSources);
  const candidates = sortEncodingCandidates([
    ...options.candidates,
    ...(options.fallbackCandidate === undefined ? [] : [options.fallbackCandidate]),
  ]);
  const selectedCandidate = candidates[0];

  if (selectedCandidate === undefined) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "At least one encoding candidate is required.",
    });
  }

  const policyWarnings = createConfidencePolicyWarnings({
    candidates,
    selectedCandidate,
    minConfidence,
    ambiguityThreshold,
    ambiguousSources,
  });

  return Object.freeze({
    selectedCandidate,
    candidates,
    warnings: mergeEncodingWarnings(options.warnings, policyWarnings),
  });
}

export function compareEncodingCandidates(
  left: EncodingCandidate,
  right: EncodingCandidate,
): number {
  const normalizedLeft = freezeEncodingCandidate(left);
  const normalizedRight = freezeEncodingCandidate(right);

  return (
    compareAscending(
      sourcePriority(normalizedLeft.source),
      sourcePriority(normalizedRight.source),
    ) ||
    compareDescending(normalizedLeft.confidence, normalizedRight.confidence) ||
    compareAscending(
      encodingPriority(normalizedLeft.encoding),
      encodingPriority(normalizedRight.encoding),
    ) ||
    compareDescending(normalizedLeft.bomLength, normalizedRight.bomLength) ||
    compareCodePointOrder(normalizedLeft.reason, normalizedRight.reason)
  );
}

function createConfidencePolicyWarnings(options: {
  readonly candidates: readonly EncodingCandidate[];
  readonly selectedCandidate: EncodingCandidate;
  readonly minConfidence: number;
  readonly ambiguityThreshold: number;
  readonly ambiguousSources: readonly EncodingDetectionSource[];
}): readonly EncodingWarning[] {
  const warnings: EncodingWarning[] = [];

  if (options.selectedCandidate.source === "fallback") {
    warnings.push(createFallbackWarning(options.selectedCandidate, options.minConfidence));
  }

  if (options.selectedCandidate.confidence < options.minConfidence) {
    warnings.push(createLowConfidenceWarning(options.selectedCandidate, options.minConfidence));
  }

  const ambiguousCandidates = findAmbiguousCandidates(options);

  if (ambiguousCandidates.length > 0) {
    warnings.push(
      createAmbiguousCandidatesWarning(
        options.selectedCandidate,
        ambiguousCandidates,
        options.ambiguityThreshold,
      ),
    );
  }

  return freezeEncodingWarnings(warnings);
}

function findAmbiguousCandidates(options: {
  readonly candidates: readonly EncodingCandidate[];
  readonly selectedCandidate: EncodingCandidate;
  readonly ambiguityThreshold: number;
  readonly ambiguousSources: readonly EncodingDetectionSource[];
}): readonly EncodingCandidate[] {
  if (!options.ambiguousSources.includes(options.selectedCandidate.source)) {
    return [];
  }

  return options.candidates.filter((candidate) => {
    if (candidate === options.selectedCandidate) {
      return false;
    }

    return (
      candidate.encoding !== options.selectedCandidate.encoding &&
      candidate.source === options.selectedCandidate.source &&
      options.ambiguousSources.includes(candidate.source) &&
      Math.abs(candidate.confidence - options.selectedCandidate.confidence) <=
        options.ambiguityThreshold
    );
  });
}

function createFallbackWarning(
  candidate: EncodingCandidate,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_FALLBACK_USED",
    message: "Fallback encoding was used because no stronger detection signal was selected.",
    details: candidateWarningDetails(candidate, {
      minConfidence,
    }),
  });
}

function createLowConfidenceWarning(
  candidate: EncodingCandidate,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "Detection confidence is below the configured threshold.",
    details: candidateWarningDetails(candidate, {
      minConfidence,
    }),
  });
}

function createAmbiguousCandidatesWarning(
  selectedCandidate: EncodingCandidate,
  ambiguousCandidates: readonly EncodingCandidate[],
  ambiguityThreshold: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_AMBIGUOUS_CANDIDATES",
    message: "Multiple encoding candidates have close confidence scores.",
    details: {
      selected: candidateDetails(selectedCandidate),
      candidates: Object.freeze(
        ambiguousCandidates.map((candidate) => candidateDetails(candidate)),
      ),
      ambiguityThreshold,
    },
  });
}

function candidateWarningDetails(
  candidate: EncodingCandidate,
  details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...candidateDetails(candidate),
    ...details,
  });
}

function candidateDetails(candidate: EncodingCandidate): Readonly<Record<string, unknown>> {
  return Object.freeze({
    encoding: candidate.encoding,
    confidence: candidate.confidence,
    source: candidate.source,
    bomLength: candidate.bomLength,
  });
}

function deduplicateCandidates(candidates: readonly EncodingCandidate[]): EncodingCandidate[] {
  const normalized: EncodingCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const candidate of candidates) {
    const normalizedCandidate = freezeEncodingCandidate(candidate);
    const key = candidateKey(normalizedCandidate);

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    normalized.push(normalizedCandidate);
  }

  return normalized;
}

function freezeEncodingCandidate(candidate: EncodingCandidate): EncodingCandidate {
  assertCandidateEncoding(candidate.encoding);
  assertConfidenceScore(candidate.confidence, "candidate.confidence");
  assertDetectionSource(candidate.source, "candidate.source");
  assertNonEmptyReason(candidate.reason);
  const bomLength = normalizeBomLength(candidate.bomLength);

  return Object.freeze({
    encoding: candidate.encoding,
    confidence: candidate.confidence,
    source: candidate.source,
    reason: candidate.reason,
    bomLength,
  });
}

function candidateKey(candidate: EncodingCandidate): string {
  return [
    candidate.source,
    candidate.encoding,
    candidate.confidence.toString(),
    candidate.bomLength.toString(),
    candidate.reason,
  ].join("\u0000");
}

function normalizeMinConfidence(minConfidence: number): number {
  assertConfidenceScore(minConfidence, "minConfidence");
  return minConfidence;
}

function normalizeAmbiguityThreshold(ambiguityThreshold: number | undefined): number {
  const value = ambiguityThreshold ?? DEFAULT_AMBIGUITY_THRESHOLD;
  assertConfidenceScore(value, "ambiguityThreshold");
  return value;
}

function normalizeAmbiguousSources(
  ambiguousSources: readonly EncodingDetectionSource[] | undefined,
): readonly EncodingDetectionSource[] {
  if (ambiguousSources === undefined) {
    return DEFAULT_AMBIGUOUS_SOURCES;
  }

  const normalized: EncodingDetectionSource[] = [];

  for (const source of ambiguousSources) {
    assertDetectionSource(source, "ambiguousSources");

    if (!normalized.includes(source)) {
      normalized.push(source);
    }
  }

  return Object.freeze(normalized);
}

function normalizeBomLength(bomLength: number | undefined): number {
  const value = bomLength ?? 0;

  if (!Number.isSafeInteger(value) || value < 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Candidate BOM length must be a non-negative safe integer.",
      details: {
        option: "candidate.bomLength",
        bomLength: value,
      },
    });
  }

  return value;
}

function assertCandidateEncoding(encoding: unknown): asserts encoding is RmemEncodingName {
  if (typeof encoding !== "string" || !isRmemEncodingName(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Candidate encoding must be a supported canonical encoding.",
      details: {
        encoding,
      },
    });
  }
}

function assertConfidenceScore(value: unknown, option: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw createEncodingError({
      code: "ENCODING_LOW_CONFIDENCE",
      message: "Confidence score must be a number between 0 and 1.",
      details: {
        option,
        value,
      },
    });
  }
}

function assertDetectionSource(
  source: unknown,
  option: string,
): asserts source is EncodingDetectionSource {
  if (
    typeof source !== "string" ||
    !ENCODING_CANDIDATE_SOURCE_PRIORITY.includes(source as EncodingDetectionSource)
  ) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Candidate detection source is unsupported.",
      details: {
        option,
        source,
      },
    });
  }
}

function assertNonEmptyReason(reason: unknown): asserts reason is string {
  if (typeof reason !== "string" || reason.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Candidate reason must be a non-empty string.",
      details: {
        option: "candidate.reason",
        valueType: typeof reason,
        length: typeof reason === "string" ? reason.length : undefined,
      },
    });
  }
}

function sourcePriority(source: EncodingDetectionSource): number {
  return SOURCE_ORDER.get(source) ?? Number.MAX_SAFE_INTEGER;
}

function encodingPriority(encoding: RmemEncodingName): number {
  return ENCODING_ORDER.get(encoding) ?? Number.MAX_SAFE_INTEGER;
}

function buildPriorityLookup<TValue extends string>(
  values: readonly TValue[],
): ReadonlyMap<TValue, number> {
  return new Map(values.map((value, index) => [value, index]));
}

function compareAscending(left: number, right: number): number {
  return left - right;
}

function compareDescending(left: number, right: number): number {
  return right - left;
}

function compareCodePointOrder(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
