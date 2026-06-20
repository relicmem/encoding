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
import type { RelicMEMEncodingName } from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { isRelicMEMEncodingName } from "../encoding/EncodingRegistry.js";
import { decodeSingleByteCodePoint } from "../encoding/SingleByteEncoding.js";
import type { SingleByteEncodingName } from "../encoding/SingleByteEncoding.js";
import { RELICMEM_PROFILE } from "../profile/EncodingProfiles.js";
import { detectByteOrderMark } from "./BomDetector.js";
import type { EncodingByteOrderMark } from "./BomDetector.js";
import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  createEncodingCandidate,
  sortEncodingCandidates,
} from "./ConfidencePolicy.js";

export type LegacyHeuristicEncodingName = Exclude<SingleByteEncodingName, "iso-8859-1">;

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
  readonly allowedEncodings?: readonly RelicMEMEncodingName[];
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
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
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
  allowedEncodings: readonly RelicMEMEncodingName[],
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
  allowedEncodings: readonly RelicMEMEncodingName[],
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
  const profile = options?.profile ?? RELICMEM_PROFILE;
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
): readonly RelicMEMEncodingName[] {
  const input = allowedEncodings ?? profile.allowedEncodings;
  const normalized: RelicMEMEncodingName[] = [];

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
    if (typeof encoding !== "string" || !isRelicMEMEncodingName(encoding)) {
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
  return options.profile.name === "relicmem" && options.utf8Validation?.valid === true;
}

function hasAllowedLegacyEncoding(allowedEncodings: readonly RelicMEMEncodingName[]): boolean {
  return LEGACY_HEURISTIC_ENCODINGS.some((encoding) => allowedEncodings.includes(encoding));
}

function decodeLegacyCodePoint(byte: number, encoding: LegacyHeuristicEncodingName): number {
  return decodeSingleByteCodePoint(byte, encoding) ?? REPLACEMENT_CODE_POINT;
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
