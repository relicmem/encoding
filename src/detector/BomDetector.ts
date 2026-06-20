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
import type { SourceByteRange } from "../contracts/source.js";
import {
  RELICMEM_ENCODING_NAMES,
  isRelicMEMEncodingName,
  normalizeEncodingLabel,
} from "../encoding/EncodingRegistry.js";
import { createEncodingCandidate } from "./ConfidencePolicy.js";

export type BomConflictPolicy = "warning" | "fatal";

export interface DetectByteOrderMarkOptions {
  readonly allowedEncodings?: readonly RelicMEMEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly conflictPolicy?: BomConflictPolicy;
}

export interface EncodingByteOrderMark {
  readonly encoding: RelicMEMEncodingName;
  readonly bomLength: number;
  readonly byteRange: SourceByteRange;
  readonly label: NormalizedEncodingLabel;
}

export interface ByteOrderMarkDetectionResult {
  readonly bom?: EncodingByteOrderMark;
  readonly candidate?: EncodingCandidate;
  readonly warnings: readonly EncodingWarning[];
}

interface BomPattern {
  readonly encoding: RelicMEMEncodingName;
  readonly bytes: readonly number[];
  readonly reason: string;
}

interface NormalizedDetectByteOrderMarkOptions {
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly conflictPolicy: BomConflictPolicy;
}

const UTF_BOM_PATTERNS = Object.freeze([
  {
    encoding: "utf-8",
    bytes: Object.freeze([0xef, 0xbb, 0xbf]),
    reason: "UTF-8 byte order mark.",
  },
  {
    encoding: "utf-16le",
    bytes: Object.freeze([0xff, 0xfe]),
    reason: "UTF-16LE byte order mark.",
  },
  {
    encoding: "utf-16be",
    bytes: Object.freeze([0xfe, 0xff]),
    reason: "UTF-16BE byte order mark.",
  },
] as const satisfies readonly BomPattern[]);

export function detectByteOrderMark(
  input: Uint8Array,
  options?: DetectByteOrderMarkOptions,
): ByteOrderMarkDetectionResult {
  assertByteInput(input);
  const normalizedOptions = normalizeDetectByteOrderMarkOptions(options);
  const pattern = findBomPattern(input);

  if (pattern === undefined) {
    return createByteOrderMarkDetectionResult({});
  }

  const bom = createEncodingByteOrderMark(pattern);
  const conflictWarning = createExplicitConflictWarning(bom, normalizedOptions);

  if (conflictWarning !== undefined && normalizedOptions.conflictPolicy === "fatal") {
    throw createEncodingError({
      code: "ENCODING_BOM_CONFLICT",
      message: "BOM encoding conflicts with explicit encoding.",
      byteRange: bom.byteRange,
      ...optionalProperty("details", conflictWarning.details),
    });
  }

  const candidate = createBomCandidateIfAllowed(bom, pattern, normalizedOptions);

  return createByteOrderMarkDetectionResult({
    bom,
    ...optionalProperty("candidate", candidate),
    warnings: conflictWarning === undefined ? [] : [conflictWarning],
  });
}

export function tryDetectByteOrderMark(
  input: Uint8Array,
  options?: DetectByteOrderMarkOptions,
): EncodingResult<ByteOrderMarkDetectionResult> {
  try {
    return encodingSuccess(detectByteOrderMark(input, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

function createBomCandidateIfAllowed(
  bom: EncodingByteOrderMark,
  pattern: BomPattern,
  options: NormalizedDetectByteOrderMarkOptions,
): EncodingCandidate | undefined {
  if (options.allowedEncodings.includes(bom.encoding)) {
    return createEncodingCandidate({
      encoding: bom.encoding,
      confidence: 1,
      source: "bom",
      reason: pattern.reason,
      bomLength: bom.bomLength,
    });
  }

  if (options.explicitEncoding !== undefined) {
    return undefined;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "BOM encoding is not allowed by the active options.",
    byteRange: bom.byteRange,
    details: {
      encoding: bom.encoding,
      bomLength: bom.bomLength,
      allowedEncodings: Object.freeze([...options.allowedEncodings]),
    },
  });
}

function createExplicitConflictWarning(
  bom: EncodingByteOrderMark,
  options: NormalizedDetectByteOrderMarkOptions,
): EncodingWarning | undefined {
  if (
    options.explicitEncoding === undefined ||
    options.explicitEncoding.canonical === bom.encoding
  ) {
    return undefined;
  }

  return createEncodingWarning({
    code: "ENCODING_BOM_CONFLICT",
    message: "BOM encoding conflicts with explicit encoding. Explicit encoding takes precedence.",
    byteRange: bom.byteRange,
    details: {
      bomEncoding: bom.encoding,
      bomLength: bom.bomLength,
      explicitEncoding: options.explicitEncoding.canonical,
      ...optionalProperty("explicitLabel", options.explicitEncoding.inputLabel),
    },
  });
}

function findBomPattern(input: Uint8Array): BomPattern | undefined {
  return UTF_BOM_PATTERNS.find((pattern) => hasBytePrefix(input, pattern.bytes));
}

function hasBytePrefix(input: Uint8Array, prefix: readonly number[]): boolean {
  if (input.byteLength < prefix.length) {
    return false;
  }

  return prefix.every((byte, index) => input[index] === byte);
}

function createEncodingByteOrderMark(pattern: BomPattern): EncodingByteOrderMark {
  const bomLength = pattern.bytes.length;

  return freezeEncodingByteOrderMark({
    encoding: pattern.encoding,
    bomLength,
    byteRange: {
      start: 0,
      end: bomLength,
    },
    label: normalizeEncodingLabel(pattern.encoding, {
      source: "bom",
    }),
  });
}

function createByteOrderMarkDetectionResult(options: {
  readonly bom?: EncodingByteOrderMark;
  readonly candidate?: EncodingCandidate;
  readonly warnings?: readonly EncodingWarning[];
}): ByteOrderMarkDetectionResult {
  return Object.freeze({
    ...optionalProperty("bom", freezeEncodingByteOrderMark(options.bom)),
    ...optionalProperty("candidate", options.candidate),
    warnings: freezeEncodingWarnings(options.warnings ?? []),
  });
}

function freezeEncodingByteOrderMark(bom: EncodingByteOrderMark): EncodingByteOrderMark;
function freezeEncodingByteOrderMark(bom: undefined): undefined;
function freezeEncodingByteOrderMark(
  bom: EncodingByteOrderMark | undefined,
): EncodingByteOrderMark | undefined;
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

function normalizeDetectByteOrderMarkOptions(
  options: DetectByteOrderMarkOptions | undefined,
): NormalizedDetectByteOrderMarkOptions {
  const allowedEncodings = normalizeAllowedEncodings(options?.allowedEncodings);
  const conflictPolicy = normalizeConflictPolicy(options?.conflictPolicy);

  return Object.freeze({
    allowedEncodings,
    ...optionalProperty(
      "explicitEncoding",
      freezeNormalizedEncodingLabel(options?.explicitEncoding),
    ),
    conflictPolicy,
  });
}

function normalizeAllowedEncodings(allowedEncodings: unknown): readonly RelicMEMEncodingName[] {
  const input = allowedEncodings ?? RELICMEM_ENCODING_NAMES;
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

function normalizeConflictPolicy(conflictPolicy: unknown): BomConflictPolicy {
  if (conflictPolicy === undefined) {
    return "warning";
  }

  if (conflictPolicy !== "warning" && conflictPolicy !== "fatal") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "BOM conflict policy must be one of: warning, fatal.",
      details: {
        option: "conflictPolicy",
        conflictPolicy,
      },
    });
  }

  return conflictPolicy;
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

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "BOM detection input must be a Uint8Array.",
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
