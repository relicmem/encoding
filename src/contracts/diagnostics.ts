import type { SourceByteRange, TextRange } from "./source.js";

export type EncodingWarningSeverity = "info" | "warning";

export const ENCODING_DIAGNOSTIC_CODES = Object.freeze([
  "ENCODING_LOW_CONFIDENCE",
  "ENCODING_FALLBACK_USED",
  "ENCODING_BOM_CONFLICT",
  "ENCODING_METADATA_CONFLICT",
  "ENCODING_UNSUPPORTED_LABEL",
  "ENCODING_UNSUPPORTED_ENCODING",
  "ENCODING_INVALID_SEQUENCE",
  "ENCODING_INVALID_SEQUENCE_REPLACED",
  "ENCODING_UNMAPPABLE_CHARACTER",
  "ENCODING_UNMAPPABLE_CHARACTER_REPLACED",
  "ENCODING_AMBIGUOUS_CANDIDATES",
  "ENCODING_BACKEND_SUBSTITUTION",
  "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
  "ENCODING_INCOMPLETE_STREAM_SEQUENCE",
  "ENCODING_SOURCE_MAP_UNAVAILABLE",
  "ENCODING_TRUNCATED_SAMPLE",
] as const);

export type EncodingDiagnosticCode = (typeof ENCODING_DIAGNOSTIC_CODES)[number];

export interface EncodingWarning {
  readonly code: EncodingDiagnosticCode;
  readonly severity: EncodingWarningSeverity;
  readonly message: string;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface CreateEncodingWarningOptions {
  readonly code: EncodingDiagnosticCode;
  readonly message: string;
  readonly severity?: EncodingWarningSeverity;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface CreateEncodingErrorOptions {
  readonly code: EncodingDiagnosticCode;
  readonly message: string;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly warnings?: readonly EncodingWarning[];
  readonly cause?: unknown;
}

export class EncodingError extends Error {
  readonly code: EncodingDiagnosticCode;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly warnings: readonly EncodingWarning[];

  constructor(options: CreateEncodingErrorOptions) {
    super(options.message);
    this.name = "EncodingError";
    this.code = options.code;
    this.warnings = freezeEncodingWarnings(options.warnings ?? []);

    const byteRange = freezeRange(options.byteRange);
    const textRange = freezeRange(options.textRange);
    const details = freezeDetails(options.details);

    if (byteRange !== undefined) {
      this.byteRange = byteRange;
    }

    if (textRange !== undefined) {
      this.textRange = textRange;
    }

    if (details !== undefined) {
      this.details = details;
    }

    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: false,
      });
    }

    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }
}

export interface EncodingSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
}

export interface EncodingFailure {
  readonly ok: false;
  readonly error: EncodingError;
}

export type EncodingResult<TValue> = EncodingSuccess<TValue> | EncodingFailure;

export function createEncodingWarning(options: CreateEncodingWarningOptions): EncodingWarning {
  return Object.freeze({
    code: options.code,
    severity: options.severity ?? "warning",
    message: options.message,
    ...optionalProperty("byteRange", freezeRange(options.byteRange)),
    ...optionalProperty("textRange", freezeRange(options.textRange)),
    ...optionalProperty("details", freezeDetails(options.details)),
  });
}

export function createEncodingError(options: CreateEncodingErrorOptions): EncodingError {
  return new EncodingError(options);
}

export function encodingSuccess<TValue>(value: TValue): EncodingSuccess<TValue> {
  return Object.freeze({
    ok: true,
    value,
  });
}

export function encodingFailure(error: EncodingError): EncodingFailure {
  return Object.freeze({
    ok: false,
    error,
  });
}

export function isEncodingError(value: unknown): value is EncodingError {
  return value instanceof EncodingError;
}

export function freezeEncodingWarnings(
  warnings: readonly EncodingWarning[],
): readonly EncodingWarning[] {
  return Object.freeze(warnings.map((warning) => freezeEncodingWarning(warning)));
}

export function mergeEncodingWarnings(
  ...warningGroups: readonly (readonly EncodingWarning[] | undefined)[]
): readonly EncodingWarning[] {
  return freezeEncodingWarnings(warningGroups.flatMap((warnings) => warnings ?? []));
}

function freezeEncodingWarning(warning: EncodingWarning): EncodingWarning {
  return Object.freeze({
    code: warning.code,
    severity: warning.severity,
    message: warning.message,
    ...optionalProperty("byteRange", freezeRange(warning.byteRange)),
    ...optionalProperty("textRange", freezeRange(warning.textRange)),
    ...optionalProperty("details", freezeDetails(warning.details)),
  });
}

function freezeRange<TRange extends SourceByteRange | TextRange>(
  range: TRange | undefined,
): TRange | undefined {
  if (range === undefined) {
    return undefined;
  }

  return Object.freeze({
    start: range.start,
    end: range.end,
  }) as TRange;
}

function freezeDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (details === undefined) {
    return undefined;
  }

  return Object.freeze({ ...details });
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
