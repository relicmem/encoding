import { Buffer } from "node:buffer";

import type {
  BackendDecodeOptions,
  BackendDecodeResult,
  DecoderBackend,
  DecoderBackendInfo,
  EncodeOptions,
  EncodeResult,
} from "../contracts/backend.js";
import {
  createEncodingError,
  freezeEncodingWarnings,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type {
  ReplacementPolicy,
  RelicMEMEncodingName,
  SourceMapMode,
} from "../contracts/encoding.js";
import { RELICMEM_ENCODING_NAMES, isRelicMEMEncodingName } from "../encoding/EncodingRegistry.js";
import {
  DEFAULT_DECODING_REPLACEMENT_CHARACTER,
  addEncodingWarningDetails,
  createInvalidSequenceError,
  normalizeControlledDecodingPolicy,
} from "../encoding/ControlledDecodingPolicy.js";
import { NATIVE_UNICODE_BACKEND } from "./NativeUnicodeBackend.js";

const TEXT_DECODER_DEFAULT_ENCODINGS = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1251",
  "windows-1252",
  "iso-8859-5",
  "koi8-r",
  "cp866",
] as const satisfies readonly RelicMEMEncodingName[]);

const TEXT_DECODER_FATAL_SAFE_ENCODINGS = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
] as const satisfies readonly RelicMEMEncodingName[]);

const TEXT_DECODER_LABELS: Readonly<Record<RelicMEMEncodingName, string | undefined>> =
  Object.freeze({
    "utf-8": "utf-8",
    "utf-16le": "utf-16le",
    "utf-16be": "utf-16be",
    "windows-1251": "windows-1251",
    "windows-1252": "windows-1252",
    "iso-8859-1": undefined,
    "iso-8859-5": "iso-8859-5",
    "koi8-r": "koi8-r",
    cp866: "cp866",
  });

const TEXT_DECODER_NORMALIZED_ENCODINGS: Readonly<
  Record<RelicMEMEncodingName, string | undefined>
> = Object.freeze({
  "utf-8": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  "windows-1251": "windows-1251",
  "windows-1252": "windows-1252",
  "iso-8859-1": undefined,
  "iso-8859-5": "iso-8859-5",
  "koi8-r": "koi8-r",
  cp866: "ibm866",
});

export interface TextDecoderLike {
  readonly encoding?: string;
  decode(input?: Uint8Array, options?: { readonly stream?: boolean }): string;
}

export type TextDecoderConstructorLike = new (
  label?: string,
  options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean },
) => TextDecoderLike;

export interface TextDecoderBackendOptions {
  readonly textDecoder?: TextDecoderConstructorLike;
  readonly version?: string;
  readonly supportedEncodings?: readonly RelicMEMEncodingName[];
}

export interface IconvLiteDecodeOptions {
  readonly stripBOM?: boolean;
}

export interface IconvLiteLike {
  readonly version?: string;
  encodingExists?(encoding: string): boolean;
  decode(input: Buffer, encoding: string, options?: IconvLiteDecodeOptions): string;
}

export interface IconvLiteBackendOptions {
  readonly version?: string;
  readonly supportedEncodings?: readonly RelicMEMEncodingName[];
}

interface NormalizedExternalDecodeOptions {
  readonly encoding: RelicMEMEncodingName;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

export class TextDecoderBackend implements DecoderBackend {
  readonly info: DecoderBackendInfo;

  private readonly textDecoder: TextDecoderConstructorLike;
  private readonly supportedEncodings: readonly RelicMEMEncodingName[];

  constructor(options: TextDecoderBackendOptions = {}) {
    const textDecoder = resolveTextDecoderConstructor(options.textDecoder);
    const requestedEncodings = normalizeSupportedEncodings(
      options.supportedEncodings ?? TEXT_DECODER_DEFAULT_ENCODINGS,
      "text-decoder",
    );
    const supportedEncodings = Object.freeze(
      requestedEncodings.filter((encoding) => textDecoderSupportsEncoding(textDecoder, encoding)),
    );

    if (supportedEncodings.length === 0) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "TextDecoder backend has no supported canonical encodings.",
        details: {
          backend: "text-decoder",
          requestedEncodings,
        },
      });
    }

    this.textDecoder = textDecoder;
    this.supportedEncodings = supportedEncodings;
    this.info = freezeDecoderBackendInfo({
      name: "text-decoder",
      ...optionalProperty("version", options.version),
      exactSourceMap: false,
    });

    Object.freeze(this);
  }

  canDecode(encoding: RelicMEMEncodingName): boolean {
    return this.supportedEncodings.includes(encoding);
  }

  canEncode(encoding: RelicMEMEncodingName): boolean {
    void encoding;

    return false;
  }

  decode(input: Uint8Array, options: BackendDecodeOptions): BackendDecodeResult {
    assertByteInput(input, "text-decoder");

    const normalizedOptions = normalizeExternalDecodeOptions(
      options,
      "text-decoder",
      this.supportedEncodings,
    );

    assertSourceMapDisabled(normalizedOptions, "text-decoder");
    assertDefaultReplacementCharacter(normalizedOptions, "text-decoder");
    assertTextDecoderReplacementPolicy(normalizedOptions);
    const controlledDecode = validateExternalControlledDecode(
      input,
      normalizedOptions,
      "text-decoder",
    );

    const decoder = new this.textDecoder(textDecoderLabel(normalizedOptions.encoding), {
      fatal: normalizedOptions.replacementPolicy === "fatal",
      ignoreBOM: !normalizedOptions.stripBom,
    });

    try {
      return freezeControlledExternalDecodeResult({
        backend: "text-decoder",
        options: normalizedOptions,
        text: decoder.decode(input),
        controlledDecode,
      });
    } catch (error) {
      if (isEncodingError(error)) {
        throw error;
      }

      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "TextDecoder backend failed after controlled decode validation.",
        details: {
          backend: "text-decoder",
          encoding: normalizedOptions.encoding,
          replacementPolicy: normalizedOptions.replacementPolicy,
        },
        cause: error,
      });
    }
  }

  encode(input: string, encoding: RelicMEMEncodingName, options?: EncodeOptions): EncodeResult {
    void input;
    void options;

    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "TextDecoder backend encode support is not implemented.",
      details: {
        backend: "text-decoder",
        encoding,
      },
    });
  }
}

export class IconvLiteBackend implements DecoderBackend {
  readonly info: DecoderBackendInfo;

  private readonly iconvLite: IconvLiteLike;
  private readonly supportedEncodings: readonly RelicMEMEncodingName[];

  constructor(iconvLite: IconvLiteLike, options: IconvLiteBackendOptions = {}) {
    assertIconvLiteLike(iconvLite);

    const requestedEncodings = normalizeSupportedEncodings(
      options.supportedEncodings ?? RELICMEM_ENCODING_NAMES,
      "iconv-lite",
    );
    const supportedEncodings = Object.freeze(
      requestedEncodings.filter((encoding) => iconvLiteSupportsEncoding(iconvLite, encoding)),
    );

    if (supportedEncodings.length === 0) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "iconv-lite backend has no supported canonical encodings.",
        details: {
          backend: "iconv-lite",
          requestedEncodings,
        },
      });
    }

    this.iconvLite = iconvLite;
    this.supportedEncodings = supportedEncodings;
    this.info = freezeDecoderBackendInfo({
      name: "iconv-lite",
      ...optionalProperty("version", options.version ?? iconvLite.version),
      exactSourceMap: false,
    });

    Object.freeze(this);
  }

  canDecode(encoding: RelicMEMEncodingName): boolean {
    return this.supportedEncodings.includes(encoding);
  }

  canEncode(encoding: RelicMEMEncodingName): boolean {
    void encoding;

    return false;
  }

  decode(input: Uint8Array, options: BackendDecodeOptions): BackendDecodeResult {
    assertByteInput(input, "iconv-lite");

    const normalizedOptions = normalizeExternalDecodeOptions(
      options,
      "iconv-lite",
      this.supportedEncodings,
    );

    assertSourceMapDisabled(normalizedOptions, "iconv-lite");
    assertDefaultReplacementCharacter(normalizedOptions, "iconv-lite");
    assertReplacementPolicy(normalizedOptions.replacementPolicy === "replace", {
      backend: "iconv-lite",
      encoding: normalizedOptions.encoding,
      reason: "iconv-lite does not expose fatal invalid-sequence ranges through this adapter.",
    });
    const controlledDecode = validateExternalControlledDecode(
      input,
      normalizedOptions,
      "iconv-lite",
    );

    try {
      return freezeControlledExternalDecodeResult({
        backend: "iconv-lite",
        options: normalizedOptions,
        text: this.iconvLite.decode(
          Buffer.from(input),
          iconvLiteLabel(normalizedOptions.encoding),
          {
            stripBOM: normalizedOptions.stripBom,
          },
        ),
        controlledDecode,
      });
    } catch (error) {
      if (isEncodingError(error)) {
        throw error;
      }

      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "iconv-lite backend failed to decode the requested encoding.",
        details: {
          backend: "iconv-lite",
          encoding: normalizedOptions.encoding,
        },
        cause: error,
      });
    }
  }

  encode(input: string, encoding: RelicMEMEncodingName, options?: EncodeOptions): EncodeResult {
    void input;
    void options;

    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "iconv-lite backend encode support is not implemented.",
      details: {
        backend: "iconv-lite",
        encoding,
      },
    });
  }
}

export function createTextDecoderBackend(options?: TextDecoderBackendOptions): TextDecoderBackend {
  return new TextDecoderBackend(options);
}

export function createIconvLiteBackend(
  iconvLite: IconvLiteLike,
  options?: IconvLiteBackendOptions,
): IconvLiteBackend {
  return new IconvLiteBackend(iconvLite, options);
}

export function isTextDecoderBackendAvailable(
  options: Pick<TextDecoderBackendOptions, "textDecoder"> = {},
): boolean {
  const textDecoder = options.textDecoder ?? globalThis.TextDecoder;

  return typeof textDecoder === "function";
}

function resolveTextDecoderConstructor(
  textDecoder: TextDecoderConstructorLike | undefined,
): TextDecoderConstructorLike {
  const resolvedTextDecoder = textDecoder ?? globalThis.TextDecoder;

  if (typeof resolvedTextDecoder !== "function") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "TextDecoder is not available in this runtime.",
      details: {
        backend: "text-decoder",
      },
    });
  }

  return resolvedTextDecoder;
}

function textDecoderSupportsEncoding(
  textDecoder: TextDecoderConstructorLike,
  encoding: RelicMEMEncodingName,
): boolean {
  const label = TEXT_DECODER_LABELS[encoding];
  const expectedEncoding = TEXT_DECODER_NORMALIZED_ENCODINGS[encoding];

  if (label === undefined || expectedEncoding === undefined) {
    return false;
  }

  try {
    const decoder = new textDecoder(label, { fatal: true });

    return normalizeTextDecoderEncoding(decoder.encoding ?? label) === expectedEncoding;
  } catch {
    return false;
  }
}

function textDecoderLabel(encoding: RelicMEMEncodingName): string {
  const label = TEXT_DECODER_LABELS[encoding];

  if (label === undefined) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "TextDecoder backend cannot decode the requested encoding.",
      details: {
        backend: "text-decoder",
        encoding,
      },
    });
  }

  return label;
}

function normalizeTextDecoderEncoding(encoding: string): string {
  return encoding.trim().toLowerCase();
}

function iconvLiteSupportsEncoding(
  iconvLite: IconvLiteLike,
  encoding: RelicMEMEncodingName,
): boolean {
  if (iconvLite.encodingExists === undefined) {
    return true;
  }

  return iconvLite.encodingExists(iconvLiteLabel(encoding));
}

function iconvLiteLabel(encoding: RelicMEMEncodingName): string {
  return encoding;
}

function normalizeExternalDecodeOptions(
  options: BackendDecodeOptions,
  backend: "text-decoder" | "iconv-lite",
  supportedEncodings: readonly RelicMEMEncodingName[],
): NormalizedExternalDecodeOptions {
  assertOptionsObject(options, backend);

  const encoding = normalizeExternalEncoding(options.encoding, backend, supportedEncodings);
  const decodingPolicy = normalizeControlledDecodingPolicy({
    replacementPolicy: options.replacementPolicy,
    replacementCharacter: options.replacementCharacter,
    errorDetails: {
      backend,
      encoding,
    },
  });

  return Object.freeze({
    encoding,
    stripBom: normalizeBoolean(options.stripBom, "stripBom", backend),
    sourceMap: normalizeSourceMap(options.sourceMap, backend),
    replacementPolicy: decodingPolicy.replacementPolicy,
    replacementCharacter: decodingPolicy.replacementCharacter,
  });
}

function normalizeExternalEncoding(
  encoding: unknown,
  backend: "text-decoder" | "iconv-lite",
  supportedEncodings: readonly RelicMEMEncodingName[],
): RelicMEMEncodingName {
  if (typeof encoding !== "string" || !isRelicMEMEncodingName(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend cannot decode the requested encoding.",
      details: {
        backend,
        encoding,
      },
    });
  }

  if (!supportedEncodings.includes(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend does not support the requested encoding.",
      details: {
        backend,
        encoding,
        supportedEncodings,
      },
    });
  }

  return encoding;
}

function assertSourceMapDisabled(
  options: NormalizedExternalDecodeOptions,
  backend: "text-decoder" | "iconv-lite",
): void {
  if (options.sourceMap === "none") {
    return;
  }

  throw createEncodingError({
    code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
    message: "External decoder backend cannot provide source maps.",
    details: {
      backend,
      encoding: options.encoding,
      sourceMap: options.sourceMap,
      exactSourceMap: false,
    },
  });
}

function assertTextDecoderReplacementPolicy(options: NormalizedExternalDecodeOptions): void {
  if (options.replacementPolicy === "replace" || isTextDecoderFatalSafeEncoding(options.encoding)) {
    return;
  }

  assertReplacementPolicy(false, {
    backend: "text-decoder",
    encoding: options.encoding,
    reason: "TextDecoder fatal mode is not reliable for this canonical encoding.",
  });
}

function isTextDecoderFatalSafeEncoding(encoding: RelicMEMEncodingName): boolean {
  return (TEXT_DECODER_FATAL_SAFE_ENCODINGS as readonly RelicMEMEncodingName[]).includes(encoding);
}

function assertDefaultReplacementCharacter(
  options: NormalizedExternalDecodeOptions,
  backend: "text-decoder" | "iconv-lite",
): void {
  if (
    options.replacementPolicy === "fatal" ||
    options.replacementCharacter === DEFAULT_DECODING_REPLACEMENT_CHARACTER
  ) {
    return;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "External decoder backend only supports the default replacement character.",
    details: {
      backend,
      encoding: options.encoding,
      replacementCharacter: options.replacementCharacter,
    },
  });
}

function assertReplacementPolicy(
  condition: boolean,
  details: Readonly<Record<string, unknown>>,
): void {
  if (condition) {
    return;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "External decoder backend cannot satisfy the requested replacement policy.",
    details,
  });
}

function normalizeSupportedEncodings(
  encodings: readonly RelicMEMEncodingName[],
  backend: "text-decoder" | "iconv-lite",
): readonly RelicMEMEncodingName[] {
  if (!Array.isArray(encodings)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend supportedEncodings must be an array.",
      details: {
        backend,
        valueType: typeof encodings,
      },
    });
  }

  const normalized: RelicMEMEncodingName[] = [];

  for (const encoding of encodings) {
    if (typeof encoding !== "string" || !isRelicMEMEncodingName(encoding)) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "External backend supportedEncodings contains an unsupported encoding.",
        details: {
          backend,
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
      message: "External backend supportedEncodings must not be empty.",
      details: {
        backend,
      },
    });
  }

  return Object.freeze(normalized);
}

function freezeDecoderBackendInfo(info: DecoderBackendInfo): DecoderBackendInfo {
  return Object.freeze({
    name: info.name,
    ...optionalProperty("version", normalizeOptionalVersion(info.version)),
    exactSourceMap: info.exactSourceMap,
  });
}

function normalizeOptionalVersion(version: unknown): string | undefined {
  if (version === undefined) {
    return undefined;
  }

  if (typeof version !== "string" || version.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend version must be a non-empty string.",
      details: {
        version,
      },
    });
  }

  return version;
}

function freezeExternalDecodeResult(options: { readonly text: string }): BackendDecodeResult {
  return Object.freeze({
    text: options.text,
    warnings: freezeEncodingWarnings([]),
  });
}

function validateExternalControlledDecode(
  input: Uint8Array,
  options: NormalizedExternalDecodeOptions,
  backend: "text-decoder" | "iconv-lite",
): BackendDecodeResult {
  try {
    return NATIVE_UNICODE_BACKEND.decode(input, {
      encoding: options.encoding,
      stripBom: options.stripBom,
      sourceMap: "none",
      replacementPolicy: options.replacementPolicy,
      replacementCharacter: options.replacementCharacter,
    });
  } catch (error) {
    if (isEncodingError(error) && error.code === "ENCODING_INVALID_SEQUENCE") {
      throw createInvalidSequenceError({
        encoding: options.encoding,
        reason: invalidSequenceReason(error),
        byteRange: error.byteRange ?? {
          start: 0,
          end: 0,
        },
        details: {
          backend,
          validationBackend: "native",
        },
        cause: error,
      });
    }

    throw error;
  }
}

function freezeControlledExternalDecodeResult(options: {
  readonly backend: "text-decoder" | "iconv-lite";
  readonly options: NormalizedExternalDecodeOptions;
  readonly text: string;
  readonly controlledDecode: BackendDecodeResult;
}): BackendDecodeResult {
  const warnings = replacementWarnings(options.controlledDecode.warnings);

  if (warnings.length === 0) {
    return freezeExternalDecodeResult({
      text: options.text,
    });
  }

  if (options.text !== options.controlledDecode.text) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External decoder replacement behavior does not match controlled decoding.",
      details: {
        backend: options.backend,
        validationBackend: "native",
        encoding: options.options.encoding,
        replacementPolicy: options.options.replacementPolicy,
        replacementCharacter: options.options.replacementCharacter,
        externalTextLength: options.text.length,
        controlledTextLength: options.controlledDecode.text.length,
      },
    });
  }

  return Object.freeze({
    text: options.text,
    warnings: addEncodingWarningDetails(warnings, {
      backend: options.backend,
      validationBackend: "native",
    }),
  });
}

function replacementWarnings(warnings: readonly EncodingWarning[]): readonly EncodingWarning[] {
  return warnings.filter((warning) => warning.code === "ENCODING_INVALID_SEQUENCE_REPLACED");
}

function invalidSequenceReason(error: {
  readonly details?: Readonly<Record<string, unknown>>;
}): string {
  const reason = error.details?.reason;

  return typeof reason === "string" ? reason : "Invalid byte sequence.";
}

function normalizeBoolean(
  value: unknown,
  option: string,
  backend: "text-decoder" | "iconv-lite",
): boolean {
  if (typeof value !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend requires normalized boolean options.",
      details: {
        backend,
        option,
        valueType: typeof value,
      },
    });
  }

  return value;
}

function normalizeSourceMap(
  sourceMap: unknown,
  backend: "text-decoder" | "iconv-lite",
): SourceMapMode {
  if (sourceMap !== "exact" && sourceMap !== "line" && sourceMap !== "none") {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "External backend requires a valid source map mode.",
      details: {
        backend,
        sourceMap,
      },
    });
  }

  return sourceMap;
}

function assertByteInput(input: unknown, backend: "text-decoder" | "iconv-lite"): void {
  if (!(input instanceof Uint8Array)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend input must be a Uint8Array.",
      details: {
        backend,
        valueType: typeof input,
      },
    });
  }
}

function assertOptionsObject(
  options: unknown,
  backend: "text-decoder" | "iconv-lite",
): asserts options is BackendDecodeOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "External backend decode options must be an object.",
      details: {
        backend,
        valueType: typeof options,
      },
    });
  }
}

function assertIconvLiteLike(iconvLite: unknown): asserts iconvLite is IconvLiteLike {
  if (typeof iconvLite !== "object" || iconvLite === null || Array.isArray(iconvLite)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "iconv-lite adapter requires an iconv-lite compatible object.",
      details: {
        valueType: typeof iconvLite,
      },
    });
  }

  const candidate = iconvLite as Partial<IconvLiteLike>;

  if (typeof candidate.decode !== "function") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "iconv-lite adapter requires a decode function.",
      details: {
        backend: "iconv-lite",
      },
    });
  }

  if (candidate.encodingExists !== undefined && typeof candidate.encodingExists !== "function") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "iconv-lite adapter encodingExists must be a function when provided.",
      details: {
        backend: "iconv-lite",
        valueType: typeof candidate.encodingExists,
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
