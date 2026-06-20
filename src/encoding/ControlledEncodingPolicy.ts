import {
  createEncodingError,
  createEncodingWarning,
  freezeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingError, EncodingWarning } from "../contracts/diagnostics.js";
import type { ReplacementPolicy, RelicMEMEncodingName } from "../contracts/encoding.js";
import type { TextRange } from "../contracts/source.js";

export const DEFAULT_ENCODING_REPLACEMENT_CHARACTER = "?";

export interface ControlledEncodingPolicy {
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

export interface NormalizeControlledEncodingPolicyOptions {
  readonly replacementPolicy?: unknown;
  readonly replacementCharacter?: unknown;
  readonly errorDetails?: Readonly<Record<string, unknown>>;
}

export interface UnmappableCharacterDiagnosticOptions {
  readonly encoding: RelicMEMEncodingName;
  readonly reason: string;
  readonly textRange: TextRange;
  readonly codePoint?: number;
  readonly replacementCharacter?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function normalizeControlledEncodingPolicy(
  options: NormalizeControlledEncodingPolicyOptions,
): ControlledEncodingPolicy {
  return Object.freeze({
    replacementPolicy: normalizeReplacementPolicy(options.replacementPolicy, options.errorDetails),
    replacementCharacter: normalizeReplacementCharacter(
      options.replacementCharacter,
      options.errorDetails,
    ),
  });
}

export function createUnmappableCharacterError(
  options: UnmappableCharacterDiagnosticOptions & {
    readonly warnings?: readonly EncodingWarning[];
    readonly cause?: unknown;
  },
): EncodingError {
  return createEncodingError({
    code: "ENCODING_UNMAPPABLE_CHARACTER",
    message: "Character cannot be encoded in the target encoding.",
    textRange: options.textRange,
    details: unmappableCharacterDetails(options),
    ...optionalProperty("warnings", options.warnings),
    ...optionalProperty("cause", options.cause),
  });
}

export function createUnmappableCharacterReplacementWarning(
  options: UnmappableCharacterDiagnosticOptions & {
    readonly replacementCharacter: string;
  },
): EncodingWarning {
  return createEncodingWarning({
    code: "ENCODING_UNMAPPABLE_CHARACTER_REPLACED",
    message: "Character was replaced during encoding.",
    textRange: options.textRange,
    details: unmappableCharacterDetails(options),
  });
}

export function freezeEncodingPolicyWarnings(
  warnings: readonly EncodingWarning[],
): readonly EncodingWarning[] {
  return freezeEncodingWarnings(warnings);
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
    return DEFAULT_ENCODING_REPLACEMENT_CHARACTER;
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

function unmappableCharacterDetails(
  options: UnmappableCharacterDiagnosticOptions,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...options.details,
    encoding: options.encoding,
    reason: options.reason,
    ...optionalProperty("codePoint", formatCodePoint(options.codePoint)),
    ...optionalProperty("replacementCharacter", options.replacementCharacter),
  });
}

function formatCodePoint(codePoint: number | undefined): string | undefined {
  if (codePoint === undefined) {
    return undefined;
  }

  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
