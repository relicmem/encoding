import type { EncodingCandidate, NormalizedEncodingLabel } from "../contracts/detection.js";
import {
  createEncodingError,
  createEncodingWarning,
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingResult, EncodingWarning } from "../contracts/diagnostics.js";
import type { RmemEncodingName } from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { isRmemEncodingName } from "../encoding/EncodingRegistry.js";
import { RMEM_PROFILE } from "../profile/EncodingProfiles.js";
import { detectByteOrderMark } from "./BomDetector.js";
import type { EncodingByteOrderMark } from "./BomDetector.js";
import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  createEncodingCandidate,
  sortEncodingCandidates,
} from "./ConfidencePolicy.js";

export type LegacyHeuristicEncodingName =
  | "windows-1251"
  | "koi8-r"
  | "cp866"
  | "iso-8859-5"
  | "windows-1252";

export type LegacyHeuristicIgnoredReason =
  | "bom"
  | "explicit-encoding"
  | "heuristics-disabled"
  | "valid-utf8"
  | "ascii-only"
  | "no-allowed-candidates"
  | "weak-signal";

export interface LegacyUtf8ValidationSignal {
  readonly valid: boolean;
}

export interface DetectLegacyEncodingOptions {
  readonly profile?: EncodingProfile;
  readonly allowedEncodings?: readonly RmemEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly minConfidence?: number;
  readonly utf8Validation?: LegacyUtf8ValidationSignal;
}

export interface LegacyEncodingHeuristicScore {
  readonly encoding: LegacyHeuristicEncodingName;
  readonly confidence: number;
  readonly highByteRatio: number;
  readonly cyrillicRatio: number;
  readonly commonCyrillicPairRatio: number;
  readonly cyrillicVowelRatio: number;
  readonly cyrillicLowercaseRatio: number;
  readonly latinLetterRatio: number;
  readonly asciiLatinLetterRatio: number;
  readonly westernHighByteRatio: number;
  readonly controlRatio: number;
  readonly replacementRatio: number;
  readonly boxDrawingRatio: number;
}

export interface LegacyEncodingHeuristicAnalysis {
  readonly byteLength: number;
  readonly highByteCount: number;
  readonly asciiOnly: boolean;
  readonly scores: readonly LegacyEncodingHeuristicScore[];
}

export interface LegacyEncodingDetectionResult {
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly bom?: EncodingByteOrderMark;
  readonly heuristic?: LegacyEncodingHeuristicAnalysis;
  readonly ignoredReason?: LegacyHeuristicIgnoredReason;
}

interface NormalizedDetectLegacyEncodingOptions {
  readonly profile: EncodingProfile;
  readonly allowedEncodings: readonly RmemEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly minConfidence: number;
  readonly utf8Validation?: LegacyUtf8ValidationSignal;
}

interface CandidateSelection {
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly ignoredReason?: LegacyHeuristicIgnoredReason;
}

interface LegacyDecodeMetrics {
  readonly highByteRatio: number;
  readonly cyrillicRatio: number;
  readonly commonCyrillicPairRatio: number;
  readonly cyrillicVowelRatio: number;
  readonly cyrillicLowercaseRatio: number;
  readonly latinLetterRatio: number;
  readonly asciiLatinLetterRatio: number;
  readonly westernHighByteRatio: number;
  readonly controlRatio: number;
  readonly replacementRatio: number;
  readonly boxDrawingRatio: number;
}

const LEGACY_HEURISTIC_ENCODINGS = Object.freeze([
  "windows-1251",
  "koi8-r",
  "cp866",
  "iso-8859-5",
  "windows-1252",
] as const satisfies readonly LegacyHeuristicEncodingName[]);

const CYRILLIC_HEURISTIC_CANDIDATE_FLOOR = 0.55;
const WINDOWS_1252_HEURISTIC_CANDIDATE_FLOOR = 0.5;
const LEGACY_WEAK_SIGNAL_FLOOR = 0.3;
const REPLACEMENT_CODE_POINT = 0xfffd;

const CYRILLIC_VOWELS = Object.freeze(
  new Set([
    0x0430, 0x0435, 0x0451, 0x0438, 0x043e, 0x0443, 0x044b, 0x044d, 0x044e, 0x044f, 0x0456, 0x0457,
    0x0454,
  ]),
);

const COMMON_CYRILLIC_PAIRS = Object.freeze(
  new Set([
    pairKey(0x043f, 0x0440),
    pairKey(0x0440, 0x0438),
    pairKey(0x0438, 0x0432),
    pairKey(0x0432, 0x0435),
    pairKey(0x0435, 0x0442),
    pairKey(0x043c, 0x0438),
    pairKey(0x0438, 0x0440),
    pairKey(0x0434, 0x043e),
    pairKey(0x043e, 0x043a),
    pairKey(0x043a, 0x0443),
    pairKey(0x0443, 0x043c),
    pairKey(0x043c, 0x0435),
    pairKey(0x0435, 0x043d),
    pairKey(0x043d, 0x0442),
    pairKey(0x0442, 0x044b),
    pairKey(0x0445, 0x0440),
    pairKey(0x0440, 0x0430),
    pairKey(0x0430, 0x043d),
    pairKey(0x043d, 0x044f),
    pairKey(0x044f, 0x0442),
    pairKey(0x0437, 0x043d),
    pairKey(0x043d, 0x0430),
    pairKey(0x043d, 0x0438),
    pairKey(0x0438, 0x044f),
    pairKey(0x0441, 0x0442),
    pairKey(0x043d, 0x043e),
    pairKey(0x0442, 0x043e),
    pairKey(0x043e, 0x0432),
    pairKey(0x043a, 0x043e),
    pairKey(0x0440, 0x043e),
    pairKey(0x0440, 0x0435),
    pairKey(0x0433, 0x043e),
    pairKey(0x0434, 0x0435),
    pairKey(0x043d, 0x0435),
    pairKey(0x043b, 0x0438),
    pairKey(0x043f, 0x043e),
    pairKey(0x043e, 0x0440),
    pairKey(0x043a, 0x0430),
    pairKey(0x0442, 0x0435),
    pairKey(0x043e, 0x0441),
    pairKey(0x043b, 0x0430),
    pairKey(0x043e, 0x0434),
    pairKey(0x0437, 0x0430),
    pairKey(0x0435, 0x0440),
    pairKey(0x0430, 0x0442),
  ]),
);

export function detectLegacyEncoding(
  input: Uint8Array,
  options?: DetectLegacyEncodingOptions,
): LegacyEncodingDetectionResult {
  assertByteInput(input);

  const normalizedOptions = normalizeDetectLegacyEncodingOptions(options);
  const bomResult = detectByteOrderMark(input, {
    allowedEncodings: normalizedOptions.allowedEncodings,
    ...optionalProperty("explicitEncoding", normalizedOptions.explicitEncoding),
  });

  if (bomResult.bom !== undefined) {
    return createLegacyEncodingDetectionResult({
      bom: bomResult.bom,
      warnings: bomResult.warnings,
      ignoredReason: "bom",
    });
  }

  if (normalizedOptions.explicitEncoding !== undefined) {
    return createLegacyEncodingDetectionResult({
      warnings: bomResult.warnings,
      ignoredReason: "explicit-encoding",
    });
  }

  if (!normalizedOptions.profile.legacyHeuristics) {
    return createLegacyEncodingDetectionResult({
      warnings: bomResult.warnings,
      ignoredReason: "heuristics-disabled",
    });
  }

  if (shouldSkipForValidUtf8(normalizedOptions)) {
    return createLegacyEncodingDetectionResult({
      warnings: bomResult.warnings,
      ignoredReason: "valid-utf8",
    });
  }

  const heuristic = analyzeLegacyEncodingHeuristic(input);

  if (heuristic.asciiOnly) {
    return createLegacyEncodingDetectionResult({
      heuristic,
      warnings: bomResult.warnings,
      ignoredReason: "ascii-only",
    });
  }

  if (!hasAllowedLegacyEncoding(normalizedOptions.allowedEncodings)) {
    return createLegacyEncodingDetectionResult({
      heuristic,
      warnings: bomResult.warnings,
      ignoredReason: "no-allowed-candidates",
    });
  }

  const selection = selectLegacyEncodingCandidates(heuristic, normalizedOptions);

  return createLegacyEncodingDetectionResult({
    heuristic,
    candidates: selection.candidates,
    warnings: [...bomResult.warnings, ...selection.warnings],
    ...optionalProperty("ignoredReason", selection.ignoredReason),
  });
}

export function tryDetectLegacyEncoding(
  input: Uint8Array,
  options?: DetectLegacyEncodingOptions,
): EncodingResult<LegacyEncodingDetectionResult> {
  try {
    return encodingSuccess(detectLegacyEncoding(input, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

function analyzeLegacyEncodingHeuristic(input: Uint8Array): LegacyEncodingHeuristicAnalysis {
  const byteLength = input.byteLength;
  const highByteCount = countHighBytes(input);

  return freezeLegacyEncodingHeuristicAnalysis({
    byteLength,
    highByteCount,
    asciiOnly: highByteCount === 0,
    scores: LEGACY_HEURISTIC_ENCODINGS.map((encoding) =>
      scoreLegacyEncoding(input, encoding, highByteCount),
    ),
  });
}

function selectLegacyEncodingCandidates(
  heuristic: LegacyEncodingHeuristicAnalysis,
  options: NormalizedDetectLegacyEncodingOptions,
): CandidateSelection {
  const viableScores = heuristic.scores.filter(isViableLegacyScore);
  const candidates = viableScores
    .map((score) => createCandidateFromScore(score, options.allowedEncodings))
    .filter(isDefined);
  const sortedCandidates = sortEncodingCandidates(candidates);
  const warnings: EncodingWarning[] = [
    ...createDisallowedScoreWarnings(viableScores, options.allowedEncodings),
  ];

  if (sortedCandidates.length === 0) {
    const strongestScore = strongestLegacyScore(heuristic.scores);

    if (strongestScore.confidence >= LEGACY_WEAK_SIGNAL_FLOOR) {
      warnings.push(createWeakLegacySignalWarning(strongestScore, options.minConfidence));
    }

    return createSelection({
      warnings,
      ignoredReason: "weak-signal",
    });
  }

  warnings.push(...createAmbiguousLegacyWarnings(sortedCandidates));

  const selectedCandidate = sortedCandidates[0];

  if (selectedCandidate !== undefined && selectedCandidate.confidence < options.minConfidence) {
    warnings.push(createLowConfidenceCandidateWarning(selectedCandidate, options.minConfidence));
  }

  return createSelection({
    candidates: sortedCandidates,
    warnings,
  });
}

function scoreLegacyEncoding(
  input: Uint8Array,
  encoding: LegacyHeuristicEncodingName,
  highByteCount: number,
): LegacyEncodingHeuristicScore {
  const metrics = collectLegacyDecodeMetrics(input, encoding, highByteCount);
  const confidence =
    encoding === "windows-1252" ? scoreWindows1252(metrics) : scoreCyrillicLegacyEncoding(metrics);

  return createLegacyEncodingHeuristicScore({
    encoding,
    confidence,
    ...metrics,
  });
}

function collectLegacyDecodeMetrics(
  input: Uint8Array,
  encoding: LegacyHeuristicEncodingName,
  highByteCount: number,
): LegacyDecodeMetrics {
  const byteLength = input.byteLength;
  const highByteRatio = ratio(highByteCount, byteLength);
  let cyrillicCount = 0;
  let cyrillicLowercaseCount = 0;
  let cyrillicVowelCount = 0;
  let commonCyrillicPairCount = 0;
  let cyrillicPairCount = 0;
  let latinLetterCount = 0;
  let asciiLatinLetterCount = 0;
  let letterCount = 0;
  let westernHighByteCount = 0;
  let controlCount = 0;
  let replacementCount = 0;
  let boxDrawingCount = 0;
  let previousCyrillic: number | undefined;

  for (const byte of input) {
    const codePoint = decodeLegacyCodePoint(byte, encoding);

    if (isReplacementCodePoint(codePoint)) {
      replacementCount += 1;
      previousCyrillic = undefined;
      continue;
    }

    if (isDisallowedControlCodePoint(codePoint)) {
      controlCount += 1;
      previousCyrillic = undefined;
      continue;
    }

    if (isBoxDrawingCodePoint(codePoint)) {
      boxDrawingCount += 1;
      previousCyrillic = undefined;
      continue;
    }

    if (byte >= 0x80 && isWesternHighCodePoint(codePoint)) {
      westernHighByteCount += 1;
    }

    if (isCyrillicLetterCodePoint(codePoint)) {
      const lowerCodePoint = toLowerCyrillicCodePoint(codePoint);
      cyrillicCount += 1;
      letterCount += 1;

      if (lowerCodePoint === codePoint) {
        cyrillicLowercaseCount += 1;
      }

      if (CYRILLIC_VOWELS.has(lowerCodePoint)) {
        cyrillicVowelCount += 1;
      }

      if (previousCyrillic !== undefined) {
        cyrillicPairCount += 1;

        if (COMMON_CYRILLIC_PAIRS.has(pairKey(previousCyrillic, lowerCodePoint))) {
          commonCyrillicPairCount += 1;
        }
      }

      previousCyrillic = lowerCodePoint;
      continue;
    }

    previousCyrillic = undefined;

    if (isLatinLetterCodePoint(codePoint)) {
      latinLetterCount += 1;
      letterCount += 1;

      if (isAsciiLatinLetterCodePoint(codePoint)) {
        asciiLatinLetterCount += 1;
      }
    }
  }

  return Object.freeze({
    highByteRatio,
    cyrillicRatio: ratio(cyrillicCount, highByteCount),
    commonCyrillicPairRatio: ratio(commonCyrillicPairCount, cyrillicPairCount),
    cyrillicVowelRatio: ratio(cyrillicVowelCount, cyrillicCount),
    cyrillicLowercaseRatio: ratio(cyrillicLowercaseCount, cyrillicCount),
    latinLetterRatio: ratio(latinLetterCount, letterCount),
    asciiLatinLetterRatio: ratio(asciiLatinLetterCount, letterCount),
    westernHighByteRatio: ratio(westernHighByteCount, highByteCount),
    controlRatio: ratio(controlCount, byteLength),
    replacementRatio: ratio(replacementCount, byteLength),
    boxDrawingRatio: ratio(boxDrawingCount, byteLength),
  });
}

function scoreCyrillicLegacyEncoding(metrics: LegacyDecodeMetrics): number {
  const mixedScriptPenalty =
    metrics.cyrillicRatio > 0 && metrics.latinLetterRatio > 0 ? 0.2 * metrics.latinLetterRatio : 0;

  return clampConfidence(
    0.3 * metrics.cyrillicRatio +
      0.25 * metrics.commonCyrillicPairRatio +
      0.15 * metrics.cyrillicVowelRatio +
      0.1 * metrics.cyrillicLowercaseRatio +
      0.2 * metrics.highByteRatio -
      0.35 * metrics.controlRatio -
      0.25 * metrics.boxDrawingRatio -
      0.2 * metrics.replacementRatio -
      mixedScriptPenalty,
  );
}

function scoreWindows1252(metrics: LegacyDecodeMetrics): number {
  const denseHighBytePenalty =
    metrics.highByteRatio > 0.55 ? (metrics.highByteRatio - 0.55) * 0.8 : 0;

  return clampConfidence(
    0.35 * metrics.latinLetterRatio +
      0.25 * metrics.westernHighByteRatio +
      0.25 * metrics.asciiLatinLetterRatio +
      0.15 * balancedWesternHighByteSignal(metrics.highByteRatio) +
      0.1 * (1 - metrics.controlRatio) -
      0.45 * metrics.cyrillicRatio -
      0.25 * metrics.controlRatio -
      0.25 * metrics.replacementRatio -
      denseHighBytePenalty,
  );
}

function isViableLegacyScore(score: LegacyEncodingHeuristicScore): boolean {
  if (score.encoding === "windows-1252") {
    return (
      score.confidence >= WINDOWS_1252_HEURISTIC_CANDIDATE_FLOOR &&
      score.latinLetterRatio >= 0.5 &&
      score.asciiLatinLetterRatio >= 0.35 &&
      score.westernHighByteRatio >= 0.3 &&
      score.controlRatio <= 0.1 &&
      score.replacementRatio <= 0.1
    );
  }

  return (
    score.confidence >= CYRILLIC_HEURISTIC_CANDIDATE_FLOOR &&
    score.cyrillicRatio >= 0.55 &&
    score.controlRatio <= 0.2 &&
    score.replacementRatio <= 0.1 &&
    score.boxDrawingRatio <= 0.25
  );
}

function createCandidateFromScore(
  score: LegacyEncodingHeuristicScore,
  allowedEncodings: readonly RmemEncodingName[],
): EncodingCandidate | undefined {
  if (!allowedEncodings.includes(score.encoding)) {
    return undefined;
  }

  const reason =
    score.encoding === "windows-1252"
      ? "Legacy heuristic matched Latin text with Windows-1252 extended bytes."
      : "Legacy Cyrillic heuristic matched Cyrillic coverage, common letter pairs and printable byte behavior.";

  return createEncodingCandidate({
    encoding: score.encoding,
    confidence: score.confidence,
    source: "heuristic",
    reason,
    bomLength: 0,
  });
}

function createDisallowedScoreWarnings(
  scores: readonly LegacyEncodingHeuristicScore[],
  allowedEncodings: readonly RmemEncodingName[],
): readonly EncodingWarning[] {
  return scores
    .filter((score) => !allowedEncodings.includes(score.encoding))
    .map((score) =>
      createEncodingWarning({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Legacy heuristic encoding is not allowed by the active options and was ignored.",
        details: {
          encoding: score.encoding,
          confidence: score.confidence,
          allowedEncodings: Object.freeze([...allowedEncodings]),
        },
      }),
    );
}

function createAmbiguousLegacyWarnings(
  candidates: readonly EncodingCandidate[],
): readonly EncodingWarning[] {
  const selectedCandidate = candidates[0];

  if (selectedCandidate === undefined) {
    return [];
  }

  const ambiguousCandidates = candidates.filter(
    (candidate) =>
      candidate !== selectedCandidate &&
      candidate.encoding !== selectedCandidate.encoding &&
      Math.abs(candidate.confidence - selectedCandidate.confidence) <= DEFAULT_AMBIGUITY_THRESHOLD,
  );

  if (ambiguousCandidates.length === 0) {
    return [];
  }

  return [
    createEncodingWarning({
      code: "ENCODING_AMBIGUOUS_CANDIDATES",
      message: "Legacy heuristic produced ambiguous candidates.",
      details: {
        ambiguityThreshold: DEFAULT_AMBIGUITY_THRESHOLD,
        selected: candidateDetails(selectedCandidate),
        candidates: Object.freeze(
          ambiguousCandidates.map((candidate) => candidateDetails(candidate)),
        ),
      },
    }),
  ];
}

function createWeakLegacySignalWarning(
  score: LegacyEncodingHeuristicScore,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "Legacy heuristic signal is too weak to create a candidate.",
    details: {
      encoding: score.encoding,
      confidence: score.confidence,
      minConfidence,
      highByteRatio: score.highByteRatio,
      cyrillicRatio: score.cyrillicRatio,
      latinLetterRatio: score.latinLetterRatio,
      controlRatio: score.controlRatio,
      replacementRatio: score.replacementRatio,
    },
  });
}

function createLowConfidenceCandidateWarning(
  candidate: EncodingCandidate,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "Legacy heuristic confidence is below the configured threshold.",
    details: {
      encoding: candidate.encoding,
      confidence: candidate.confidence,
      source: candidate.source,
      bomLength: candidate.bomLength,
      minConfidence,
    },
  });
}

function strongestLegacyScore(
  scores: readonly LegacyEncodingHeuristicScore[],
): LegacyEncodingHeuristicScore {
  const firstScore = scores[0];

  if (firstScore === undefined) {
    throw new Error("Expected legacy heuristic scores.");
  }

  return scores.reduce((strongest, score) =>
    score.confidence > strongest.confidence ? score : strongest,
  );
}

function candidateDetails(candidate: EncodingCandidate): Readonly<Record<string, unknown>> {
  return Object.freeze({
    encoding: candidate.encoding,
    confidence: candidate.confidence,
    source: candidate.source,
    bomLength: candidate.bomLength,
  });
}

function createSelection(options: {
  readonly candidates?: readonly EncodingCandidate[];
  readonly warnings?: readonly EncodingWarning[];
  readonly ignoredReason?: LegacyHeuristicIgnoredReason;
}): CandidateSelection {
  return Object.freeze({
    candidates: sortEncodingCandidates(options.candidates ?? []),
    warnings: freezeEncodingWarnings(options.warnings ?? []),
    ...optionalProperty("ignoredReason", options.ignoredReason),
  });
}

function createLegacyEncodingDetectionResult(options: {
  readonly candidates?: readonly EncodingCandidate[];
  readonly warnings?: readonly EncodingWarning[];
  readonly bom?: EncodingByteOrderMark;
  readonly heuristic?: LegacyEncodingHeuristicAnalysis;
  readonly ignoredReason?: LegacyHeuristicIgnoredReason;
}): LegacyEncodingDetectionResult {
  return Object.freeze({
    candidates: sortEncodingCandidates(options.candidates ?? []),
    warnings: freezeEncodingWarnings(options.warnings ?? []),
    ...optionalProperty("bom", freezeEncodingByteOrderMark(options.bom)),
    ...optionalProperty("heuristic", freezeLegacyEncodingHeuristicAnalysis(options.heuristic)),
    ...optionalProperty("ignoredReason", options.ignoredReason),
  });
}

function freezeLegacyEncodingHeuristicAnalysis(
  heuristic: LegacyEncodingHeuristicAnalysis,
): LegacyEncodingHeuristicAnalysis;
function freezeLegacyEncodingHeuristicAnalysis(heuristic: undefined): undefined;
function freezeLegacyEncodingHeuristicAnalysis(
  heuristic: LegacyEncodingHeuristicAnalysis | undefined,
): LegacyEncodingHeuristicAnalysis | undefined;
function freezeLegacyEncodingHeuristicAnalysis(
  heuristic: LegacyEncodingHeuristicAnalysis | undefined,
): LegacyEncodingHeuristicAnalysis | undefined {
  if (heuristic === undefined) {
    return undefined;
  }

  return Object.freeze({
    byteLength: heuristic.byteLength,
    highByteCount: heuristic.highByteCount,
    asciiOnly: heuristic.asciiOnly,
    scores: Object.freeze(
      heuristic.scores.map((score) => createLegacyEncodingHeuristicScore(score)),
    ),
  });
}

function createLegacyEncodingHeuristicScore(options: {
  readonly encoding: LegacyHeuristicEncodingName;
  readonly confidence: number;
  readonly highByteRatio: number;
  readonly cyrillicRatio: number;
  readonly commonCyrillicPairRatio: number;
  readonly cyrillicVowelRatio: number;
  readonly cyrillicLowercaseRatio: number;
  readonly latinLetterRatio: number;
  readonly asciiLatinLetterRatio: number;
  readonly westernHighByteRatio: number;
  readonly controlRatio: number;
  readonly replacementRatio: number;
  readonly boxDrawingRatio: number;
}): LegacyEncodingHeuristicScore {
  return Object.freeze({
    encoding: options.encoding,
    confidence: clampConfidence(options.confidence),
    highByteRatio: clampRatio(options.highByteRatio),
    cyrillicRatio: clampRatio(options.cyrillicRatio),
    commonCyrillicPairRatio: clampRatio(options.commonCyrillicPairRatio),
    cyrillicVowelRatio: clampRatio(options.cyrillicVowelRatio),
    cyrillicLowercaseRatio: clampRatio(options.cyrillicLowercaseRatio),
    latinLetterRatio: clampRatio(options.latinLetterRatio),
    asciiLatinLetterRatio: clampRatio(options.asciiLatinLetterRatio),
    westernHighByteRatio: clampRatio(options.westernHighByteRatio),
    controlRatio: clampRatio(options.controlRatio),
    replacementRatio: clampRatio(options.replacementRatio),
    boxDrawingRatio: clampRatio(options.boxDrawingRatio),
  });
}

function freezeEncodingByteOrderMark(
  bom: EncodingByteOrderMark | undefined,
): EncodingByteOrderMark | undefined {
  if (bom === undefined) {
    return undefined;
  }

  return Object.freeze({
    encoding: bom.encoding,
    bomLength: bom.bomLength,
    byteRange: Object.freeze({
      start: bom.byteRange.start,
      end: bom.byteRange.end,
    }),
    label: Object.freeze({
      ...optionalProperty("inputLabel", bom.label.inputLabel),
      canonical: bom.label.canonical,
      aliases: Object.freeze([...bom.label.aliases]),
      source: bom.label.source,
    }),
  });
}

function normalizeDetectLegacyEncodingOptions(
  options: DetectLegacyEncodingOptions | undefined,
): NormalizedDetectLegacyEncodingOptions {
  const profile = options?.profile ?? RMEM_PROFILE;
  const allowedEncodings = normalizeAllowedEncodings(options?.allowedEncodings, profile);
  const minConfidence = normalizeMinConfidence(options?.minConfidence, profile.minConfidence);
  const utf8Validation = normalizeUtf8ValidationSignal(options?.utf8Validation);

  return Object.freeze({
    profile,
    allowedEncodings,
    ...optionalProperty(
      "explicitEncoding",
      freezeNormalizedEncodingLabel(options?.explicitEncoding),
    ),
    minConfidence,
    ...optionalProperty("utf8Validation", utf8Validation),
  });
}

function normalizeAllowedEncodings(
  allowedEncodings: unknown,
  profile: EncodingProfile,
): readonly RmemEncodingName[] {
  const input = allowedEncodings ?? profile.allowedEncodings;
  const normalized: RmemEncodingName[] = [];

  if (!Array.isArray(input)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Allowed encodings must be an array.",
      details: {
        option: "allowedEncodings",
        valueType: typeof input,
      },
    });
  }

  for (const encoding of input as readonly unknown[]) {
    if (typeof encoding !== "string" || !isRmemEncodingName(encoding)) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Allowed encodings must contain only supported canonical encodings.",
        details: {
          option: "allowedEncodings",
          encoding,
        },
      });
    }

    if (!profile.allowedEncodings.includes(encoding)) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Encoding is not allowed by the active profile.",
        details: {
          option: "allowedEncodings",
          encoding,
          allowedEncodings: Object.freeze([...profile.allowedEncodings]),
        },
      });
    }

    if (!normalized.includes(encoding)) {
      normalized.push(encoding);
    }
  }

  if (normalized.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Allowed encodings must not be empty.",
      details: {
        option: "allowedEncodings",
      },
    });
  }

  return Object.freeze(normalized);
}

function normalizeMinConfidence(minConfidence: unknown, defaultValue: number): number {
  const value = minConfidence ?? defaultValue;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw createEncodingError({
      code: "ENCODING_LOW_CONFIDENCE",
      message: "Minimum confidence must be a number between 0 and 1.",
      details: {
        option: "minConfidence",
        value,
      },
    });
  }

  return value;
}

function normalizeUtf8ValidationSignal(
  utf8Validation: unknown,
): LegacyUtf8ValidationSignal | undefined {
  if (utf8Validation === undefined) {
    return undefined;
  }

  if (
    typeof utf8Validation !== "object" ||
    utf8Validation === null ||
    Array.isArray(utf8Validation)
  ) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-8 validation signal must be an object.",
      details: {
        option: "utf8Validation",
        valueType: typeof utf8Validation,
      },
    });
  }

  const signal = utf8Validation as Partial<LegacyUtf8ValidationSignal>;

  if (typeof signal.valid !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-8 validation signal must include a boolean valid field.",
      details: {
        option: "utf8Validation.valid",
        valueType: typeof signal.valid,
      },
    });
  }

  return Object.freeze({
    valid: signal.valid,
  });
}

function freezeNormalizedEncodingLabel(
  label: NormalizedEncodingLabel | undefined,
): NormalizedEncodingLabel | undefined {
  if (label === undefined) {
    return undefined;
  }

  return Object.freeze({
    ...optionalProperty("inputLabel", label.inputLabel),
    canonical: label.canonical,
    aliases: Object.freeze([...label.aliases]),
    source: label.source,
  });
}

function shouldSkipForValidUtf8(options: NormalizedDetectLegacyEncodingOptions): boolean {
  return options.profile.name === "rmem" && options.utf8Validation?.valid === true;
}

function hasAllowedLegacyEncoding(allowedEncodings: readonly RmemEncodingName[]): boolean {
  return LEGACY_HEURISTIC_ENCODINGS.some((encoding) => allowedEncodings.includes(encoding));
}

function decodeLegacyCodePoint(byte: number, encoding: LegacyHeuristicEncodingName): number {
  if (byte < 0x80) {
    return byte;
  }

  const value = highByteCodePointTable(encoding)[byte - 0x80];

  return value === undefined || value < 0 ? REPLACEMENT_CODE_POINT : value;
}

function highByteCodePointTable(encoding: LegacyHeuristicEncodingName): readonly number[] {
  switch (encoding) {
    case "windows-1251":
      return WINDOWS_1251_HIGH_BYTE_CODE_POINTS;
    case "koi8-r":
      return KOI8_R_HIGH_BYTE_CODE_POINTS;
    case "cp866":
      return CP866_HIGH_BYTE_CODE_POINTS;
    case "iso-8859-5":
      return ISO_8859_5_HIGH_BYTE_CODE_POINTS;
    case "windows-1252":
      return WINDOWS_1252_HIGH_BYTE_CODE_POINTS;
    default:
      return unsupportedLegacyEncodingTable(encoding);
  }
}

function unsupportedLegacyEncodingTable(encoding: never): readonly number[] {
  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "Unsupported legacy heuristic encoding.",
    details: {
      encoding,
    },
  });
}

function countHighBytes(input: Uint8Array): number {
  let count = 0;

  for (const byte of input) {
    if (byte >= 0x80) {
      count += 1;
    }
  }

  return count;
}

function balancedWesternHighByteSignal(highByteRatio: number): number {
  if (highByteRatio <= 0) {
    return 0;
  }

  if (highByteRatio <= 0.35) {
    return highByteRatio / 0.35;
  }

  if (highByteRatio >= 0.75) {
    return 0;
  }

  return 1 - (highByteRatio - 0.35) / 0.4;
}

function isReplacementCodePoint(codePoint: number): boolean {
  return codePoint === REPLACEMENT_CODE_POINT;
}

function isDisallowedControlCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0 ||
    (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}

function isBoxDrawingCodePoint(codePoint: number): boolean {
  return codePoint >= 0x2500 && codePoint <= 0x259f;
}

function isCyrillicLetterCodePoint(codePoint: number): boolean {
  return codePoint >= 0x0400 && codePoint <= 0x04ff;
}

function isLatinLetterCodePoint(codePoint: number): boolean {
  return isAsciiLatinLetterCodePoint(codePoint) || (codePoint >= 0x00c0 && codePoint <= 0x024f);
}

function isAsciiLatinLetterCodePoint(codePoint: number): boolean {
  return (codePoint >= 0x41 && codePoint <= 0x5a) || (codePoint >= 0x61 && codePoint <= 0x7a);
}

function isWesternHighCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x00a0 && codePoint <= 0x024f) ||
    codePoint === 0x20ac ||
    codePoint === 0x2013 ||
    codePoint === 0x2014 ||
    codePoint === 0x2018 ||
    codePoint === 0x2019 ||
    codePoint === 0x201c ||
    codePoint === 0x201d ||
    codePoint === 0x2022 ||
    codePoint === 0x2026 ||
    codePoint === 0x2122
  );
}

function toLowerCyrillicCodePoint(codePoint: number): number {
  if (codePoint >= 0x0410 && codePoint <= 0x042f) {
    return codePoint + 0x20;
  }

  switch (codePoint) {
    case 0x0401:
      return 0x0451;
    case 0x0402:
      return 0x0452;
    case 0x0403:
      return 0x0453;
    case 0x0404:
      return 0x0454;
    case 0x0405:
      return 0x0455;
    case 0x0406:
      return 0x0456;
    case 0x0407:
      return 0x0457;
    case 0x0408:
      return 0x0458;
    case 0x0409:
      return 0x0459;
    case 0x040a:
      return 0x045a;
    case 0x040b:
      return 0x045b;
    case 0x040c:
      return 0x045c;
    case 0x040e:
      return 0x045e;
    case 0x040f:
      return 0x045f;
    case 0x0490:
      return 0x0491;
    default:
      return codePoint;
  }
}

function pairKey(left: number, right: number): number {
  return left * 0x10000 + right;
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function clampRatio(value: number): number {
  return clampConfidence(value);
}

function clampConfidence(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return Number(value.toFixed(6));
}

function isDefined<TValue>(value: TValue | undefined): value is TValue {
  return value !== undefined;
}

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Legacy detection input must be a Uint8Array.",
      details: {
        inputType: typeof input,
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

const WINDOWS_1251_HIGH_BYTE_CODE_POINTS = Object.freeze([
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039,
  0x040a, 0x040c, 0x040b, 0x040f, 0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  -1, 0x2122, 0x0459, 0x203a, 0x045a, 0x045c, 0x045b, 0x045f, 0x00a0, 0x040e, 0x045e, 0x0408,
  0x00a4, 0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407,
  0x00b0, 0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb,
  0x0458, 0x0405, 0x0455, 0x0457, 0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417,
  0x0418, 0x0419, 0x041a, 0x041b, 0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423,
  0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f,
  0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b,
  0x043c, 0x043d, 0x043e, 0x043f, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447,
  0x0448, 0x0449, 0x044a, 0x044b, 0x044c, 0x044d, 0x044e, 0x044f,
] as const satisfies readonly number[]);

const KOI8_R_HIGH_BYTE_CODE_POINTS = Object.freeze([
  0x2500, 0x2502, 0x250c, 0x2510, 0x2514, 0x2518, 0x251c, 0x2524, 0x252c, 0x2534, 0x253c, 0x2580,
  0x2584, 0x2588, 0x258c, 0x2590, 0x2591, 0x2592, 0x2593, 0x2320, 0x25a0, 0x2219, 0x221a, 0x2248,
  0x2264, 0x2265, 0x00a0, 0x2321, 0x00b0, 0x00b2, 0x00b7, 0x00f7, 0x2550, 0x2551, 0x2552, 0x0451,
  0x2553, 0x2554, 0x2555, 0x2556, 0x2557, 0x2558, 0x2559, 0x255a, 0x255b, 0x255c, 0x255d, 0x255e,
  0x255f, 0x2560, 0x2561, 0x0401, 0x2562, 0x2563, 0x2564, 0x2565, 0x2566, 0x2567, 0x2568, 0x2569,
  0x256a, 0x256b, 0x256c, 0x00a9, 0x044e, 0x0430, 0x0431, 0x0446, 0x0434, 0x0435, 0x0444, 0x0433,
  0x0445, 0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f, 0x044f, 0x0440, 0x0441,
  0x0442, 0x0443, 0x0436, 0x0432, 0x044c, 0x044b, 0x0437, 0x0448, 0x044d, 0x0449, 0x0447, 0x044a,
  0x042e, 0x0410, 0x0411, 0x0426, 0x0414, 0x0415, 0x0424, 0x0413, 0x0425, 0x0418, 0x0419, 0x041a,
  0x041b, 0x041c, 0x041d, 0x041e, 0x041f, 0x042f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0416, 0x0412,
  0x042c, 0x042b, 0x0417, 0x0428, 0x042d, 0x0429, 0x0427, 0x042a,
] as const satisfies readonly number[]);

const CP866_HIGH_BYTE_CODE_POINTS = Object.freeze([
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041a, 0x041b,
  0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
  0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f, 0x0430, 0x0431, 0x0432, 0x0433,
  0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f,
  0x2591, 0x2592, 0x2593, 0x2502, 0x2524, 0x2561, 0x2562, 0x2556, 0x2555, 0x2563, 0x2551, 0x2557,
  0x255d, 0x255c, 0x255b, 0x2510, 0x2514, 0x2534, 0x252c, 0x251c, 0x2500, 0x253c, 0x255e, 0x255f,
  0x255a, 0x2554, 0x2569, 0x2566, 0x2560, 0x2550, 0x256c, 0x2567, 0x2568, 0x2564, 0x2565, 0x2559,
  0x2558, 0x2552, 0x2553, 0x256b, 0x256a, 0x2518, 0x250c, 0x2588, 0x2584, 0x258c, 0x2590, 0x2580,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044a, 0x044b,
  0x044c, 0x044d, 0x044e, 0x044f, 0x0401, 0x0451, 0x0404, 0x0454, 0x0407, 0x0457, 0x040e, 0x045e,
  0x00b0, 0x2219, 0x00b7, 0x221a, 0x2116, 0x00a4, 0x25a0, 0x00a0,
] as const satisfies readonly number[]);

const ISO_8859_5_HIGH_BYTE_CODE_POINTS = Object.freeze([
  0x0080, 0x0081, 0x0082, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008a, 0x008b,
  0x008c, 0x008d, 0x008e, 0x008f, 0x0090, 0x0091, 0x0092, 0x0093, 0x0094, 0x0095, 0x0096, 0x0097,
  0x0098, 0x0099, 0x009a, 0x009b, 0x009c, 0x009d, 0x009e, 0x009f, 0x00a0, 0x0401, 0x0402, 0x0403,
  0x0404, 0x0405, 0x0406, 0x0407, 0x0408, 0x0409, 0x040a, 0x040b, 0x040c, 0x00ad, 0x040e, 0x040f,
  0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x0419, 0x041a, 0x041b,
  0x041c, 0x041d, 0x041e, 0x041f, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427,
  0x0428, 0x0429, 0x042a, 0x042b, 0x042c, 0x042d, 0x042e, 0x042f, 0x0430, 0x0431, 0x0432, 0x0433,
  0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x0439, 0x043a, 0x043b, 0x043c, 0x043d, 0x043e, 0x043f,
  0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044a, 0x044b,
  0x044c, 0x044d, 0x044e, 0x044f, 0x2116, 0x0451, 0x0452, 0x0453, 0x0454, 0x0455, 0x0456, 0x0457,
  0x0458, 0x0459, 0x045a, 0x045b, 0x045c, 0x00a7, 0x045e, 0x045f,
] as const satisfies readonly number[]);

const WINDOWS_1252_HIGH_BYTE_CODE_POINTS = Object.freeze([
  0x20ac, -1, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, -1, 0x017d, -1, -1, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, -1, 0x017e, 0x0178, 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4,
  0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0,
  0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc,
  0x00bd, 0x00be, 0x00bf, 0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6, 0x00c7, 0x00c8,
  0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4,
  0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df, 0x00e0,
  0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec,
  0x00ed, 0x00ee, 0x00ef, 0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8,
  0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0x00ff,
] as const satisfies readonly number[]);
