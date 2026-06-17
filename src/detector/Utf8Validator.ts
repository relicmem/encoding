import type { EncodingCandidate } from "../contracts/detection.js";
import {
  createEncodingError,
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingResult, EncodingWarning } from "../contracts/diagnostics.js";
import type { RmemEncodingName } from "../contracts/encoding.js";
import type { SourceByteRange } from "../contracts/source.js";
import { RMEM_ENCODING_NAMES, isRmemEncodingName } from "../encoding/EncodingRegistry.js";
import { createEncodingCandidate } from "./ConfidencePolicy.js";

export type Utf8ValidationInvalidPolicy = "collect" | "fatal";

export type Utf8ValidationHigherPrioritySource = "explicit" | "bom";

export interface ValidateUtf8Options {
  readonly allowedEncodings?: readonly RmemEncodingName[];
  readonly higherPrioritySource?: Utf8ValidationHigherPrioritySource;
  readonly invalidPolicy?: Utf8ValidationInvalidPolicy;
}

export interface Utf8ValidationIssue {
  readonly byteRange: SourceByteRange;
  readonly reason: string;
}

export interface Utf8ValidationPendingSequence {
  readonly byteRange: SourceByteRange;
  readonly expectedLength: number;
  readonly consumedLength: number;
}

export interface Utf8ValidationWriteResult {
  readonly bytesRead: number;
  readonly errors: readonly Utf8ValidationIssue[];
  readonly pending?: Utf8ValidationPendingSequence;
}

export interface Utf8ValidationResult {
  readonly valid: boolean;
  readonly bytesRead: number;
  readonly errors: readonly Utf8ValidationIssue[];
  readonly warnings: readonly EncodingWarning[];
  readonly candidate?: EncodingCandidate;
}

interface NormalizedValidateUtf8Options {
  readonly allowedEncodings: readonly RmemEncodingName[];
  readonly higherPrioritySource?: Utf8ValidationHigherPrioritySource;
  readonly invalidPolicy: Utf8ValidationInvalidPolicy;
}

interface PendingUtf8Sequence {
  readonly start: number;
  readonly expectedLength: number;
  readonly acceptsSecondByte: (byte: number) => boolean;
  consumedLength: number;
}

interface Utf8SequenceDefinition {
  readonly expectedLength: number;
  readonly acceptsSecondByte: (byte: number) => boolean;
}

export class Utf8Validator {
  readonly #options: NormalizedValidateUtf8Options;
  readonly #errors: Utf8ValidationIssue[] = [];
  #bytesRead = 0;
  #pending: PendingUtf8Sequence | undefined;
  #finished = false;

  constructor(options?: ValidateUtf8Options) {
    this.#options = normalizeValidateUtf8Options(options);
  }

  get bytesRead(): number {
    return this.#bytesRead;
  }

  get pending(): Utf8ValidationPendingSequence | undefined {
    return freezePendingSequence(this.#pending);
  }

  write(chunk: Uint8Array): Utf8ValidationWriteResult {
    assertByteInput(chunk);
    assertNotFinished(this.#finished);

    const errorsBefore = this.#errors.length;

    for (const byte of chunk) {
      this.#processByte(byte);
    }

    return createUtf8ValidationWriteResult({
      bytesRead: this.#bytesRead,
      errors: this.#errors.slice(errorsBefore),
      ...optionalProperty("pending", this.#pending),
    });
  }

  finish(): Utf8ValidationResult {
    assertNotFinished(this.#finished);
    this.#finished = true;

    if (this.#pending !== undefined) {
      this.#recordInvalidSequence(
        this.#pending.start,
        this.#pending.start + this.#pending.consumedLength,
        "Incomplete UTF-8 sequence.",
      );
      this.#pending = undefined;
    }

    const errors = freezeValidationIssues(this.#errors);
    const valid = errors.length === 0;
    const candidate =
      valid && shouldCreateUtf8Candidate(this.#options)
        ? createEncodingCandidate({
            encoding: "utf-8",
            confidence: 1,
            source: "utf8-validation",
            reason: "Valid UTF-8 byte sequence.",
            bomLength: 0,
          })
        : undefined;

    return createUtf8ValidationResult({
      valid,
      bytesRead: this.#bytesRead,
      errors,
      ...optionalProperty("candidate", candidate),
      warnings: [],
    });
  }

  #processByte(byte: number): void {
    let consumed = false;

    while (!consumed) {
      if (this.#pending === undefined) {
        this.#processLeadingByte(byte);
        consumed = true;
        continue;
      }

      consumed = this.#processContinuationByte(byte);
    }

    this.#bytesRead += 1;
  }

  #processLeadingByte(byte: number): void {
    if (byte <= 0x7f) {
      return;
    }

    const sequence = utf8SequenceDefinition(byte);

    if (sequence === undefined) {
      this.#recordInvalidSequence(
        this.#bytesRead,
        this.#bytesRead + 1,
        "Invalid UTF-8 leading byte.",
      );
      return;
    }

    this.#pending = {
      start: this.#bytesRead,
      expectedLength: sequence.expectedLength,
      acceptsSecondByte: sequence.acceptsSecondByte,
      consumedLength: 1,
    };
  }

  #processContinuationByte(byte: number): boolean {
    const pending = this.#pending;

    if (pending === undefined) {
      throw new Error("Expected a pending UTF-8 sequence.");
    }

    const isSecondByte = pending.consumedLength === 1;
    const isValidContinuation = isSecondByte
      ? pending.acceptsSecondByte(byte)
      : isUtf8ContinuationByte(byte);

    if (!isValidContinuation) {
      this.#recordInvalidSequence(
        pending.start,
        pending.start + pending.consumedLength,
        "Invalid UTF-8 continuation byte.",
      );
      this.#pending = undefined;
      return false;
    }

    pending.consumedLength += 1;

    if (pending.consumedLength === pending.expectedLength) {
      this.#pending = undefined;
    }

    return true;
  }

  #recordInvalidSequence(byteStart: number, byteEnd: number, reason: string): void {
    const issue = createUtf8ValidationIssue(byteStart, byteEnd, reason);

    if (this.#options.invalidPolicy === "fatal") {
      throw createEncodingError({
        code: "ENCODING_INVALID_SEQUENCE",
        message: reason,
        byteRange: issue.byteRange,
        details: {
          encoding: "utf-8",
        },
      });
    }

    this.#errors.push(issue);
  }
}

export function createUtf8Validator(options?: ValidateUtf8Options): Utf8Validator {
  return new Utf8Validator(options);
}

export function validateUtf8(
  input: Uint8Array,
  options?: ValidateUtf8Options,
): Utf8ValidationResult {
  const validator = createUtf8Validator(options);
  validator.write(input);
  return validator.finish();
}

export function tryValidateUtf8(
  input: Uint8Array,
  options?: ValidateUtf8Options,
): EncodingResult<Utf8ValidationResult> {
  try {
    return encodingSuccess(validateUtf8(input, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

function utf8SequenceDefinition(byte: number): Utf8SequenceDefinition | undefined {
  if (byte >= 0xc2 && byte <= 0xdf) {
    return {
      expectedLength: 2,
      acceptsSecondByte: isUtf8ContinuationByte,
    };
  }

  if (byte >= 0xe0 && byte <= 0xef) {
    return {
      expectedLength: 3,
      acceptsSecondByte: (second) => {
        if (byte === 0xe0) {
          return second >= 0xa0 && second <= 0xbf;
        }

        if (byte === 0xed) {
          return second >= 0x80 && second <= 0x9f;
        }

        return isUtf8ContinuationByte(second);
      },
    };
  }

  if (byte >= 0xf0 && byte <= 0xf4) {
    return {
      expectedLength: 4,
      acceptsSecondByte: (second) => {
        if (byte === 0xf0) {
          return second >= 0x90 && second <= 0xbf;
        }

        if (byte === 0xf4) {
          return second >= 0x80 && second <= 0x8f;
        }

        return isUtf8ContinuationByte(second);
      },
    };
  }

  return undefined;
}

function shouldCreateUtf8Candidate(options: NormalizedValidateUtf8Options): boolean {
  return options.higherPrioritySource === undefined && options.allowedEncodings.includes("utf-8");
}

function createUtf8ValidationWriteResult(options: {
  readonly bytesRead: number;
  readonly errors: readonly Utf8ValidationIssue[];
  readonly pending?: PendingUtf8Sequence;
}): Utf8ValidationWriteResult {
  return Object.freeze({
    bytesRead: options.bytesRead,
    errors: freezeValidationIssues(options.errors),
    ...optionalProperty("pending", freezePendingSequence(options.pending)),
  });
}

function createUtf8ValidationResult(options: {
  readonly valid: boolean;
  readonly bytesRead: number;
  readonly errors: readonly Utf8ValidationIssue[];
  readonly warnings: readonly EncodingWarning[];
  readonly candidate?: EncodingCandidate;
}): Utf8ValidationResult {
  return Object.freeze({
    valid: options.valid,
    bytesRead: options.bytesRead,
    errors: freezeValidationIssues(options.errors),
    warnings: freezeEncodingWarnings(options.warnings),
    ...optionalProperty("candidate", options.candidate),
  });
}

function createUtf8ValidationIssue(
  byteStart: number,
  byteEnd: number,
  reason: string,
): Utf8ValidationIssue {
  return Object.freeze({
    byteRange: Object.freeze({
      start: byteStart,
      end: byteEnd,
    }),
    reason,
  });
}

function freezeValidationIssues(
  issues: readonly Utf8ValidationIssue[],
): readonly Utf8ValidationIssue[] {
  return Object.freeze(
    issues.map((issue) =>
      createUtf8ValidationIssue(issue.byteRange.start, issue.byteRange.end, issue.reason),
    ),
  );
}

function freezePendingSequence(
  pending: PendingUtf8Sequence | undefined,
): Utf8ValidationPendingSequence | undefined {
  if (pending === undefined) {
    return undefined;
  }

  return Object.freeze({
    byteRange: Object.freeze({
      start: pending.start,
      end: pending.start + pending.consumedLength,
    }),
    expectedLength: pending.expectedLength,
    consumedLength: pending.consumedLength,
  });
}

function normalizeValidateUtf8Options(
  options: ValidateUtf8Options | undefined,
): NormalizedValidateUtf8Options {
  return Object.freeze({
    allowedEncodings: normalizeAllowedEncodings(options?.allowedEncodings),
    ...optionalProperty(
      "higherPrioritySource",
      normalizeHigherPrioritySource(options?.higherPrioritySource),
    ),
    invalidPolicy: normalizeInvalidPolicy(options?.invalidPolicy),
  });
}

function normalizeAllowedEncodings(allowedEncodings: unknown): readonly RmemEncodingName[] {
  const input = allowedEncodings ?? RMEM_ENCODING_NAMES;
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

function normalizeHigherPrioritySource(
  higherPrioritySource: unknown,
): Utf8ValidationHigherPrioritySource | undefined {
  if (higherPrioritySource === undefined) {
    return undefined;
  }

  if (higherPrioritySource !== "explicit" && higherPrioritySource !== "bom") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-8 validation higher priority source must be one of: explicit, bom.",
      details: {
        option: "higherPrioritySource",
        higherPrioritySource,
      },
    });
  }

  return higherPrioritySource;
}

function normalizeInvalidPolicy(invalidPolicy: unknown): Utf8ValidationInvalidPolicy {
  if (invalidPolicy === undefined) {
    return "collect";
  }

  if (invalidPolicy !== "collect" && invalidPolicy !== "fatal") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-8 invalid policy must be one of: collect, fatal.",
      details: {
        option: "invalidPolicy",
        invalidPolicy,
      },
    });
  }

  return invalidPolicy;
}

function isUtf8ContinuationByte(byte: number): boolean {
  return byte >= 0x80 && byte <= 0xbf;
}

function assertByteInput(input: unknown): asserts input is Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "UTF-8 validation input must be a Uint8Array.",
      details: {
        inputType: typeof input,
      },
    });
  }
}

function assertNotFinished(finished: boolean): void {
  if (finished) {
    throw createEncodingError({
      code: "ENCODING_INVALID_SEQUENCE",
      message: "UTF-8 validator cannot accept more input after finish.",
      details: {
        encoding: "utf-8",
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
