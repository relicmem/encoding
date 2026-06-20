import {
  createEncodingError,
  createEncodingWarning,
  freezeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingError, EncodingWarning } from "../contracts/diagnostics.js";
import type { ReplacementPolicy, RelicMEMEncodingName } from "../contracts/encoding.js";
import type { SourceByteRange, TextRange } from "../contracts/source.js";

export const DEFAULT_DECODING_REPLACEMENT_CHARACTER = "\uFFFD";

export interface ControlledDecodingPolicy {
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

export interface NormalizeControlledDecodingPolicyOptions {
  readonly replacementPolicy?: unknown;
  readonly replacementCharacter?: unknown;
  readonly errorDetails?: Readonly<Record<string, unknown>>;
}

export interface InvalidSequenceDiagnosticOptions {
  readonly encoding: RelicMEMEncodingName;
  readonly reason: string;
  readonly byteRange: SourceByteRange;
  readonly textRange?: TextRange;
  readonly replacementCharacter?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function normalizeControlledDecodingPolicy(
  options: NormalizeControlledDecodingPolicyOptions,
): ControlledDecodingPolicy {
  return Object.freeze({
    replacementPolicy: normalizeReplacementPolicy(options.replacementPolicy, options.errorDetails),
    replacementCharacter: normalizeReplacementCharacter(
      options.replacementCharacter,
      options.errorDetails,
    ),
  });
}

export function createInvalidSequenceError(
  options: InvalidSequenceDiagnosticOptions & {
    readonly warnings?: readonly EncodingWarning[];
    readonly cause?: unknown;
  },
): EncodingError {
  return createEncodingError({
    code: "ENCODING_INVALID_SEQUENCE",
    message: "Invalid byte sequence.",
    byteRange: options.byteRange,
    ...optionalProperty("textRange", options.textRange),
    details: invalidSequenceDetails(options),
    ...optionalProperty("warnings", options.warnings),
    ...optionalProperty("cause", options.cause),
  });
}

export function createInvalidSequenceReplacementWarning(
  options: InvalidSequenceDiagnosticOptions & {
    readonly replacementCharacter: string;
  },
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_INVALID_SEQUENCE_REPLACED",
    message: "Invalid byte sequence was replaced.",
    byteRange: options.byteRange,
    ...optionalProperty("textRange", options.textRange),
    details: invalidSequenceDetails(options),
  });
}

export function addEncodingWarningDetails(
  warnings: readonly EncodingWarning[],
  details: Readonly<Record<string, unknown>>,
): readonly EncodingWarning[] {
  return freezeEncodingWarnings(
    warnings.map((warning) =>
      createEncodingWarning({
        code: warning.code,
        severity: warning.severity,
        message: warning.message,
        ...optionalProperty("byteRange", warning.byteRange),
        ...optionalProperty("textRange", warning.textRange),
        details: Object.freeze({
          ...warning.details,
          ...details,
        }),
      }),
    ),
  );
}

function normalizeReplacementPolicy(
  policy: unknown,
  details: Readonly<Record<string, unknown>> | undefined,
): ReplacementPolicy {
  if (policy === undefined) {
    return "fatal";
  }

  if (policy !== "fatal" && policy !== "replace") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Replacement policy must be one of: fatal, replace.",
      details: {
        ...details,
        replacementPolicy: policy,
      },
    });
  }

  return policy;
}

function normalizeReplacementCharacter(
  replacementCharacter: unknown,
  details: Readonly<Record<string, unknown>> | undefined,
): string {
  if (replacementCharacter === undefined) {
    return DEFAULT_DECODING_REPLACEMENT_CHARACTER;
  }

  if (typeof replacementCharacter !== "string" || replacementCharacter.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Replacement character must be a non-empty string.",
      details: {
        ...details,
        valueType: typeof replacementCharacter,
        length: typeof replacementCharacter === "string" ? replacementCharacter.length : undefined,
      },
    });
  }

  return replacementCharacter;
}

function invalidSequenceDetails(
  options: InvalidSequenceDiagnosticOptions,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...options.details,
    encoding: options.encoding,
    reason: options.reason,
    ...optionalProperty("replacementCharacter", options.replacementCharacter),
  });
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
