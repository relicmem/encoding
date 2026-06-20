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
import { RELICMEM_PROFILE } from "../profile/EncodingProfiles.js";
import { detectByteOrderMark } from "./BomDetector.js";
import type { EncodingByteOrderMark } from "./BomDetector.js";
import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  createEncodingCandidate,
  sortEncodingCandidates,
} from "./ConfidencePolicy.js";

export type Utf16HeuristicIgnoredReason =
  | "bom"
  | "explicit-encoding"
  | "heuristics-disabled"
  | "insufficient-data"
  | "odd-byte-length"
  | "unsupported-utf32"
  | "weak-signal";

export type Utf16HeuristicByteOrder = "le" | "be";

export interface DetectUtf16Options {
  readonly profile?: EncodingProfile;
  readonly allowedEncodings?: readonly RelicMEMEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly minConfidence?: number;
}

export interface Utf16ByteOrderHeuristicScore {
  readonly byteOrder: Utf16HeuristicByteOrder;
  readonly encoding: "utf-16le" | "utf-16be";
  readonly confidence: number;
  readonly highByteNullRatio: number;
  readonly lowByteNullRatio: number;
  readonly printableRatio: number;
  readonly controlRatio: number;
}

export interface Utf16HeuristicAnalysis {
  readonly byteLength: number;
  readonly codeUnitCount: number;
  readonly evenByteNullRatio: number;
  readonly oddByteNullRatio: number;
  readonly oddByteLength: boolean;
  readonly likelyUtf32: boolean;
  readonly scores: readonly Utf16ByteOrderHeuristicScore[];
}

export interface Utf16DetectionResult {
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly bom?: EncodingByteOrderMark;
  readonly heuristic?: Utf16HeuristicAnalysis;
  readonly ignoredReason?: Utf16HeuristicIgnoredReason;
}

interface NormalizedDetectUtf16Options {
  readonly profile: EncodingProfile;
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly minConfidence: number;
}

interface CandidateSelection {
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly ignoredReason?: Utf16HeuristicIgnoredReason;
}

const MIN_UTF16_HEURISTIC_CODE_UNITS = 4;
const UTF16_HEURISTIC_CANDIDATE_FLOOR = 0.6;
const UTF16_WEAK_SIGNAL_FLOOR = 0.4;
const UTF16_STRONG_NUL_RATIO = 0.6;
const UTF16_MIN_NUL_SEPARATION = 0.35;
const UTF16_MIN_PRINTABLE_RATIO = 0.8;
const UTF16_MAX_CONTROL_RATIO = 0.05;

export function detectUtf16(input: Uint8Array, options?: DetectUtf16Options): Utf16DetectionResult {
  assertByteInput(input);

  const normalizedOptions = normalizeDetectUtf16Options(options);
  const bomResult = detectByteOrderMark(input, {
    allowedEncodings: normalizedOptions.allowedEncodings,
    ...optionalProperty("explicitEncoding", normalizedOptions.explicitEncoding),
  });

  if (bomResult.bom !== undefined) {
    return createUtf16DetectionResult({
      bom: bomResult.bom,
      candidates:
        isUtf16Encoding(bomResult.bom.encoding) && bomResult.candidate !== undefined
          ? [bomResult.candidate]
          : [],
      warnings: bomResult.warnings,
      ignoredReason: "bom",
    });
  }

  if (normalizedOptions.explicitEncoding !== undefined) {
    return createUtf16DetectionResult({
      warnings: bomResult.warnings,
      ignoredReason: "explicit-encoding",
    });
  }

  if (!normalizedOptions.profile.utf16Heuristics) {
    return createUtf16DetectionResult({
      warnings: bomResult.warnings,
      ignoredReason: "heuristics-disabled",
    });
  }

  const heuristic = analyzeUtf16Heuristic(input);
  const selection = selectUtf16HeuristicCandidates(heuristic, normalizedOptions);

  return createUtf16DetectionResult({
    heuristic,
    candidates: selection.candidates,
    warnings: [...bomResult.warnings, ...selection.warnings],
    ...optionalProperty("ignoredReason", selection.ignoredReason),
  });
}

export function tryDetectUtf16(
  input: Uint8Array,
  options?: DetectUtf16Options,
): EncodingResult<Utf16DetectionResult> {
  try {
    return encodingSuccess(detectUtf16(input, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

function analyzeUtf16Heuristic(input: Uint8Array): Utf16HeuristicAnalysis {
  const byteLength = input.byteLength;
  const codeUnitCount = Math.floor(byteLength / 2);
  const evenByteNullRatio = nullRatioForParity(input, 0);
  const oddByteNullRatio = nullRatioForParity(input, 1);
  const oddByteLength = byteLength % 2 !== 0;
  const likelyUtf32 = looksLikeUtf32(input);

  return freezeUtf16HeuristicAnalysis({
    byteLength,
    codeUnitCount,
    evenByteNullRatio,
    oddByteNullRatio,
    oddByteLength,
    likelyUtf32,
    scores: [
      scoreUtf16ByteOrder(input, "le", evenByteNullRatio, oddByteNullRatio),
      scoreUtf16ByteOrder(input, "be", oddByteNullRatio, evenByteNullRatio),
    ],
  });
}

function selectUtf16HeuristicCandidates(
  heuristic: Utf16HeuristicAnalysis,
  options: NormalizedDetectUtf16Options,
): CandidateSelection {
  if (heuristic.oddByteLength) {
    return createSelection({
      warnings: [createOddByteLengthWarning(heuristic)],
      ignoredReason: "odd-byte-length",
    });
  }

  if (heuristic.codeUnitCount < MIN_UTF16_HEURISTIC_CODE_UNITS) {
    return createSelection({
      ignoredReason: "insufficient-data",
    });
  }

  if (heuristic.likelyUtf32) {
    return createSelection({
      warnings: [createUnsupportedUtf32Warning(heuristic)],
      ignoredReason: "unsupported-utf32",
    });
  }

  const viableScores = heuristic.scores.filter(isViableUtf16Score);
  const candidates = viableScores
    .map((score) => createCandidateFromScore(score, options.allowedEncodings))
    .filter(isDefined);
  const sortedCandidates = sortEncodingCandidates(candidates);
  const warnings: EncodingWarning[] = [];

  warnings.push(...createDisallowedScoreWarnings(viableScores, options.allowedEncodings));

  if (sortedCandidates.length === 0) {
    const strongestScore = strongestUtf16Score(heuristic.scores);

    if (strongestScore.confidence >= UTF16_WEAK_SIGNAL_FLOOR) {
      warnings.push(createWeakUtf16SignalWarning(strongestScore, options.minConfidence));
    }

    return createSelection({
      warnings,
      ignoredReason: "weak-signal",
    });
  }

  warnings.push(...createAmbiguousUtf16Warnings(sortedCandidates));

  const selectedCandidate = sortedCandidates[0];

  if (selectedCandidate !== undefined && selectedCandidate.confidence < options.minConfidence) {
    warnings.push(createLowConfidenceCandidateWarning(selectedCandidate, options.minConfidence));
  }

  return createSelection({
    candidates: sortedCandidates,
    warnings,
  });
}

function isViableUtf16Score(score: Utf16ByteOrderHeuristicScore): boolean {
  return (
    score.confidence >= UTF16_HEURISTIC_CANDIDATE_FLOOR &&
    score.highByteNullRatio >= UTF16_STRONG_NUL_RATIO &&
    score.highByteNullRatio - score.lowByteNullRatio >= UTF16_MIN_NUL_SEPARATION &&
    score.printableRatio >= UTF16_MIN_PRINTABLE_RATIO &&
    score.controlRatio <= UTF16_MAX_CONTROL_RATIO
  );
}

function scoreUtf16ByteOrder(
  input: Uint8Array,
  byteOrder: Utf16HeuristicByteOrder,
  lowByteNullRatio: number,
  highByteNullRatio: number,
): Utf16ByteOrderHeuristicScore {
  const codeUnitCount = Math.floor(input.byteLength / 2);

  if (codeUnitCount === 0) {
    return createScore({
      byteOrder,
      confidence: 0,
      highByteNullRatio,
      lowByteNullRatio,
      printableRatio: 0,
      controlRatio: 0,
    });
  }

  let printableCodeUnits = 0;
  let controlCodeUnits = 0;
  let offset = 0;

  while (offset + 1 < input.byteLength) {
    const codeUnit = readUtf16CodeUnit(input, offset, byteOrder);

    if (isHighSurrogate(codeUnit)) {
      const nextOffset = offset + 2;

      if (nextOffset + 1 < input.byteLength) {
        const nextCodeUnit = readUtf16CodeUnit(input, nextOffset, byteOrder);

        if (isLowSurrogate(nextCodeUnit)) {
          printableCodeUnits += 2;
          offset += 4;
          continue;
        }
      }

      controlCodeUnits += 1;
      offset += 2;
      continue;
    }

    if (isLowSurrogate(codeUnit) || isDisallowedControlCodeUnit(codeUnit)) {
      controlCodeUnits += 1;
    } else if (isPrintableCodeUnit(codeUnit)) {
      printableCodeUnits += 1;
    }

    offset += 2;
  }

  const printableRatio = printableCodeUnits / codeUnitCount;
  const controlRatio = controlCodeUnits / codeUnitCount;
  const nullSeparation = Math.max(0, highByteNullRatio - lowByteNullRatio);
  const confidence = clampConfidence(
    0.45 * highByteNullRatio + 0.25 * nullSeparation + 0.3 * printableRatio - 0.25 * controlRatio,
  );

  return createScore({
    byteOrder,
    confidence,
    highByteNullRatio,
    lowByteNullRatio,
    printableRatio,
    controlRatio,
  });
}

function createCandidateFromScore(
  score: Utf16ByteOrderHeuristicScore,
  allowedEncodings: readonly RelicMEMEncodingName[],
): EncodingCandidate | undefined {
  if (!allowedEncodings.includes(score.encoding)) {
    return undefined;
  }

  const label = score.encoding === "utf-16le" ? "UTF-16LE" : "UTF-16BE";

  return createEncodingCandidate({
    encoding: score.encoding,
    confidence: score.confidence,
    source: "utf16-heuristic",
    reason: `${label} heuristic matched NUL distribution, byte parity and printable code-unit ratio.`,
    bomLength: 0,
  });
}

function createOddByteLengthWarning(heuristic: Utf16HeuristicAnalysis): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "UTF-16 heuristic was skipped because byte length is odd.",
    byteRange: {
      start: Math.max(0, heuristic.byteLength - 1),
      end: heuristic.byteLength,
    },
    details: {
      byteLength: heuristic.byteLength,
      reason: "odd-byte-length",
    },
  });
}

function createUnsupportedUtf32Warning(heuristic: Utf16HeuristicAnalysis): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "Input looks like UTF-32, which is not supported by this detector.",
    details: {
      byteLength: heuristic.byteLength,
      reason: "unsupported-utf32",
    },
  });
}

function createWeakUtf16SignalWarning(
  score: Utf16ByteOrderHeuristicScore,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "UTF-16 heuristic signal is too weak to create a candidate.",
    details: {
      encoding: score.encoding,
      confidence: score.confidence,
      minConfidence,
      highByteNullRatio: score.highByteNullRatio,
      lowByteNullRatio: score.lowByteNullRatio,
      printableRatio: score.printableRatio,
      controlRatio: score.controlRatio,
    },
  });
}

function createLowConfidenceCandidateWarning(
  candidate: EncodingCandidate,
  minConfidence: number,
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_LOW_CONFIDENCE",
    message: "UTF-16 heuristic confidence is below the configured threshold.",
    details: {
      encoding: candidate.encoding,
      confidence: candidate.confidence,
      source: candidate.source,
      bomLength: candidate.bomLength,
      minConfidence,
    },
  });
}

function createDisallowedScoreWarnings(
  scores: readonly Utf16ByteOrderHeuristicScore[],
  allowedEncodings: readonly RelicMEMEncodingName[],
): readonly EncodingWarning[] {
  return scores
    .filter((score) => !allowedEncodings.includes(score.encoding))
    .map((score) =>
      createEncodingWarning({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "UTF-16 heuristic encoding is not allowed by the active options and was ignored.",
        details: {
          encoding: score.encoding,
          confidence: score.confidence,
          allowedEncodings: Object.freeze([...allowedEncodings]),
        },
      }),
    );
}

function createAmbiguousUtf16Warnings(
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
      message: "UTF-16 byte order heuristic produced ambiguous candidates.",
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

function strongestUtf16Score(
  scores: readonly Utf16ByteOrderHeuristicScore[],
): Utf16ByteOrderHeuristicScore {
  const firstScore = scores[0];

  if (firstScore === undefined) {
    throw new Error("Expected UTF-16 heuristic scores.");
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
  readonly ignoredReason?: Utf16HeuristicIgnoredReason;
}): CandidateSelection {
  return Object.freeze({
    candidates: sortEncodingCandidates(options.candidates ?? []),
    warnings: freezeEncodingWarnings(options.warnings ?? []),
    ...optionalProperty("ignoredReason", options.ignoredReason),
  });
}

function createUtf16DetectionResult(options: {
  readonly candidates?: readonly EncodingCandidate[];
  readonly warnings?: readonly EncodingWarning[];
  readonly bom?: EncodingByteOrderMark;
  readonly heuristic?: Utf16HeuristicAnalysis;
  readonly ignoredReason?: Utf16HeuristicIgnoredReason;
}): Utf16DetectionResult {
  return Object.freeze({
    candidates: sortEncodingCandidates(options.candidates ?? []),
    warnings: freezeEncodingWarnings(options.warnings ?? []),
    ...optionalProperty("bom", freezeEncodingByteOrderMark(options.bom)),
    ...optionalProperty("heuristic", freezeUtf16HeuristicAnalysis(options.heuristic)),
    ...optionalProperty("ignoredReason", options.ignoredReason),
  });
}

function freezeUtf16HeuristicAnalysis(heuristic: Utf16HeuristicAnalysis): Utf16HeuristicAnalysis;
function freezeUtf16HeuristicAnalysis(heuristic: undefined): undefined;
function freezeUtf16HeuristicAnalysis(
  heuristic: Utf16HeuristicAnalysis | undefined,
): Utf16HeuristicAnalysis | undefined;
function freezeUtf16HeuristicAnalysis(
  heuristic: Utf16HeuristicAnalysis | undefined,
): Utf16HeuristicAnalysis | undefined {
  if (heuristic === undefined) {
    return undefined;
  }

  return Object.freeze({
    byteLength: heuristic.byteLength,
    codeUnitCount: heuristic.codeUnitCount,
    evenByteNullRatio: heuristic.evenByteNullRatio,
    oddByteNullRatio: heuristic.oddByteNullRatio,
    oddByteLength: heuristic.oddByteLength,
    likelyUtf32: heuristic.likelyUtf32,
    scores: Object.freeze(heuristic.scores.map((score) => createScore(score))),
  });
}

function createScore(options: {
  readonly byteOrder: Utf16HeuristicByteOrder;
  readonly confidence: number;
  readonly highByteNullRatio: number;
  readonly lowByteNullRatio: number;
  readonly printableRatio: number;
  readonly controlRatio: number;
}): Utf16ByteOrderHeuristicScore {
  return Object.freeze({
    byteOrder: options.byteOrder,
    encoding: options.byteOrder === "le" ? "utf-16le" : "utf-16be",
    confidence: clampConfidence(options.confidence),
    highByteNullRatio: clampRatio(options.highByteNullRatio),
    lowByteNullRatio: clampRatio(options.lowByteNullRatio),
    printableRatio: clampRatio(options.printableRatio),
    controlRatio: clampRatio(options.controlRatio),
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

function normalizeDetectUtf16Options(
  options: DetectUtf16Options | undefined,
): NormalizedDetectUtf16Options {
  const profile = options?.profile ?? RELICMEM_PROFILE;
  const allowedEncodings = normalizeAllowedEncodings(options?.allowedEncodings, profile);
  const minConfidence = normalizeMinConfidence(options?.minConfidence, profile.minConfidence);

  return Object.freeze({
    profile,
    allowedEncodings,
    ...optionalProperty(
      "explicitEncoding",
      freezeNormalizedEncodingLabel(options?.explicitEncoding),
    ),
    minConfidence,
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

function nullRatioForParity(input: Uint8Array, parity: 0 | 1): number {
  let total = 0;
  let nulls = 0;

  for (let offset = parity; offset < input.byteLength; offset += 2) {
    total += 1;

    if (input[offset] === 0) {
      nulls += 1;
    }
  }

  return total === 0 ? 0 : nulls / total;
}

function looksLikeUtf32(input: Uint8Array): boolean {
  const codePointCount = Math.floor(input.byteLength / 4);

  if (codePointCount < MIN_UTF16_HEURISTIC_CODE_UNITS || input.byteLength % 4 !== 0) {
    return false;
  }

  const nullRatios = [0, 1, 2, 3].map((lane) => nullRatioForModulo(input, lane, 4));
  const printableRatios = [0, 1, 2, 3].map((lane) => printableAsciiRatioForModulo(input, lane, 4));
  const nullLaneCount = nullRatios.filter((ratio) => ratio >= 0.85).length;
  const printableLaneCount = printableRatios.filter((ratio) => ratio >= 0.7).length;

  return nullLaneCount >= 3 && printableLaneCount === 1;
}

function nullRatioForModulo(input: Uint8Array, start: number, modulo: number): number {
  let total = 0;
  let nulls = 0;

  for (let offset = start; offset < input.byteLength; offset += modulo) {
    total += 1;

    if (input[offset] === 0) {
      nulls += 1;
    }
  }

  return total === 0 ? 0 : nulls / total;
}

function printableAsciiRatioForModulo(input: Uint8Array, start: number, modulo: number): number {
  let total = 0;
  let printable = 0;

  for (let offset = start; offset < input.byteLength; offset += modulo) {
    total += 1;

    const byte = input[offset];

    if (byte !== undefined && isPrintableAsciiByte(byte)) {
      printable += 1;
    }
  }

  return total === 0 ? 0 : printable / total;
}

function readUtf16CodeUnit(
  input: Uint8Array,
  byteOffset: number,
  byteOrder: Utf16HeuristicByteOrder,
): number {
  const first = input[byteOffset];
  const second = input[byteOffset + 1];

  if (first === undefined || second === undefined) {
    throw new RangeError("Byte offset is outside the input bounds.");
  }

  return byteOrder === "le" ? first | (second << 8) : (first << 8) | second;
}

function isPrintableCodeUnit(codeUnit: number): boolean {
  return (
    codeUnit === 0x09 ||
    codeUnit === 0x0a ||
    codeUnit === 0x0d ||
    (codeUnit >= 0x20 && codeUnit <= 0xd7ff) ||
    (codeUnit >= 0xe000 && codeUnit <= 0xfffd)
  );
}

function isDisallowedControlCodeUnit(codeUnit: number): boolean {
  return (
    codeUnit === 0x00 ||
    (codeUnit < 0x20 && codeUnit !== 0x09 && codeUnit !== 0x0a && codeUnit !== 0x0d) ||
    (codeUnit >= 0x7f && codeUnit <= 0x9f)
  );
}

function isPrintableAsciiByte(byte: number): boolean {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isUtf16Encoding(encoding: RelicMEMEncodingName): encoding is "utf-16le" | "utf-16be" {
  return encoding === "utf-16le" || encoding === "utf-16be";
}

function isDefined<TValue>(value: TValue | undefined): value is TValue {
  return value !== undefined;
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

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-16 detection input must be a Uint8Array.",
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
