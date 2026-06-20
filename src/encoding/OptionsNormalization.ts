import { DECODER_BACKEND_NAMES } from "../contracts/backend.js";
import type { DecoderBackendName } from "../contracts/backend.js";
import type { NormalizedEncodingLabel } from "../contracts/detection.js";
import { createEncodingError } from "../contracts/diagnostics.js";
import type {
  DecodeDocumentOptions,
  DetectEncodingOptions,
  EncodingMetadata,
  ReplacementPolicy,
  RelicMEMEncodingName,
  SourceMapMode,
} from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import type { EncodingProfilePolicy } from "../profile/EncodingProfiles.js";
import { resolveEncodingProfilePolicy } from "../profile/EncodingProfiles.js";
import { isRelicMEMEncodingName, normalizeEncodingLabel } from "./EncodingRegistry.js";
import { sniffEncodingMetadata } from "./MetadataSniffing.js";
import type { EncodingMetadataSniffingResult } from "./MetadataSniffing.js";

export interface NormalizedDetectEncodingOptions {
  readonly profile: EncodingProfile;
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly defaultEncoding: NormalizedEncodingLabel;
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly minConfidence: number;
  readonly metadata?: EncodingMetadata;
  readonly metadataSniffing: EncodingMetadataSniffingResult;
  readonly sampleSizeBytes: number;
}

export interface NormalizedDecodeDocumentOptions extends NormalizedDetectEncodingOptions {
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
  readonly backendPreference: readonly DecoderBackendName[];
}

interface CommonNormalizedOptions {
  readonly policy: EncodingProfilePolicy;
  readonly explicitEncoding?: NormalizedEncodingLabel;
  readonly defaultEncoding: NormalizedEncodingLabel;
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly minConfidence: number;
  readonly metadata?: EncodingMetadata;
  readonly metadataSniffing: EncodingMetadataSniffingResult;
  readonly sampleSizeBytes: number;
}

export function normalizeDetectEncodingOptions(
  options?: DetectEncodingOptions,
): NormalizedDetectEncodingOptions {
  const normalized = normalizeCommonEncodingOptions(options);

  return Object.freeze({
    profile: normalized.policy.profile,
    ...optionalProperty("explicitEncoding", normalized.explicitEncoding),
    defaultEncoding: normalized.defaultEncoding,
    allowedEncodings: normalized.allowedEncodings,
    minConfidence: normalized.minConfidence,
    ...optionalProperty("metadata", normalized.metadata),
    metadataSniffing: normalized.metadataSniffing,
    sampleSizeBytes: normalized.sampleSizeBytes,
  });
}

export function normalizeDecodeDocumentOptions(
  options?: DecodeDocumentOptions,
): NormalizedDecodeDocumentOptions {
  const normalized = normalizeCommonEncodingOptions(options);
  const decodeOptions = normalizeOptionsObject(options, "Decode document options");

  return Object.freeze({
    profile: normalized.policy.profile,
    ...optionalProperty("explicitEncoding", normalized.explicitEncoding),
    defaultEncoding: normalized.defaultEncoding,
    allowedEncodings: normalized.allowedEncodings,
    minConfidence: normalized.minConfidence,
    ...optionalProperty("metadata", normalized.metadata),
    metadataSniffing: normalized.metadataSniffing,
    sampleSizeBytes: normalized.sampleSizeBytes,
    stripBom: resolveBooleanOption(decodeOptions.stripBom, normalized.policy.stripBom, "stripBom"),
    sourceMap: resolveSourceMapMode(decodeOptions.sourceMap, normalized.policy.sourceMap),
    replacementPolicy: resolveReplacementPolicy(
      decodeOptions.replacementPolicy,
      normalized.policy.replacementPolicy,
    ),
    replacementCharacter: resolveReplacementCharacter(
      decodeOptions.replacementCharacter,
      normalized.policy.replacementCharacter,
    ),
    backendPreference: resolveBackendPreference(
      decodeOptions.backendPreference,
      normalized.policy.backendPreference,
    ),
  });
}

function normalizeCommonEncodingOptions(
  options: DecodeDocumentOptions | DetectEncodingOptions | undefined,
): CommonNormalizedOptions {
  const encodingOptions = normalizeOptionsObject(options, "Encoding options");
  const policy = resolveEncodingProfilePolicy(encodingOptions.profile);
  const allowedEncodings = resolveAllowedEncodings(
    encodingOptions.allowedEncodings,
    policy.profile,
  );
  const explicitEncoding = resolveExplicitEncoding(
    encodingOptions.explicitEncoding,
    policy.profile,
    allowedEncodings,
  );
  const defaultEncoding = resolveDefaultEncoding(
    encodingOptions.defaultEncoding,
    policy.profile,
    allowedEncodings,
  );
  const metadata = normalizeMetadata(encodingOptions.metadata);
  const metadataSniffing = sniffEncodingMetadata({
    profile: policy.profile,
    allowedEncodings,
    ...optionalProperty("metadata", metadata),
    ...optionalProperty("explicitEncoding", explicitEncoding),
  });
  const minConfidence = resolveMinConfidence(
    encodingOptions.minConfidence,
    policy.profile.minConfidence,
    "minConfidence",
  );
  const sampleSizeBytes = resolveSampleSizeBytes(
    encodingOptions.sampleSizeBytes,
    policy.sampleSizeBytes,
  );

  return Object.freeze({
    policy,
    ...optionalProperty("explicitEncoding", explicitEncoding),
    defaultEncoding,
    allowedEncodings,
    minConfidence,
    ...optionalProperty("metadata", metadata),
    metadataSniffing,
    sampleSizeBytes,
  });
}

function resolveAllowedEncodings(
  allowedEncodings: readonly RelicMEMEncodingName[] | undefined,
  profile: EncodingProfile,
): readonly RelicMEMEncodingName[] {
  if (allowedEncodings === undefined) {
    return profile.allowedEncodings;
  }

  const normalized = normalizeEncodingNameList(allowedEncodings, "allowedEncodings", {
    allowEmpty: false,
  });

  assertEncodingSubset(normalized, profile.allowedEncodings, "allowedEncodings");

  return normalized;
}

function resolveExplicitEncoding(
  explicitEncoding: string | undefined,
  profile: EncodingProfile,
  allowedEncodings: readonly RelicMEMEncodingName[],
): NormalizedEncodingLabel | undefined {
  if (explicitEncoding === undefined) {
    return undefined;
  }

  const label = normalizeEncodingLabel(explicitEncoding, {
    source: "explicit",
    profile,
  });

  assertEncodingAllowed(label.canonical, allowedEncodings, "explicitEncoding");

  return label;
}

function resolveDefaultEncoding(
  defaultEncoding: RelicMEMEncodingName | undefined,
  profile: EncodingProfile,
  allowedEncodings: readonly RelicMEMEncodingName[],
): NormalizedEncodingLabel {
  const label = normalizeEncodingLabel(defaultEncoding ?? profile.defaultEncoding, {
    source: defaultEncoding === undefined ? "profile" : "default",
    profile,
  });

  assertEncodingAllowed(label.canonical, allowedEncodings, "defaultEncoding");

  return label;
}

function normalizeMetadata(metadata: unknown): EncodingMetadata | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    throw invalidOptionsError("Encoding metadata must be an object.", {
      option: "metadata",
      valueType: typeof metadata,
    });
  }

  const metadataRecord = metadata as Partial<EncodingMetadata>;

  return Object.freeze({
    ...optionalProperty(
      "declaredEncoding",
      normalizeOptionalString(metadataRecord.declaredEncoding, "metadata.declaredEncoding"),
    ),
    ...optionalProperty(
      "contentType",
      normalizeOptionalString(metadataRecord.contentType, "metadata.contentType"),
    ),
    ...optionalProperty(
      "htmlHeadSample",
      normalizeOptionalString(metadataRecord.htmlHeadSample, "metadata.htmlHeadSample"),
    ),
    ...optionalProperty(
      "sourceName",
      normalizeOptionalString(metadataRecord.sourceName, "metadata.sourceName"),
    ),
  });
}

function resolveMinConfidence(
  minConfidence: unknown,
  defaultValue: number | undefined,
  option: string,
): number {
  const value = minConfidence ?? defaultValue;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidOptionsError("Minimum confidence must be a number between 0 and 1.", {
      option,
      value,
    });
  }

  return value;
}

function resolveSampleSizeBytes(sampleSizeBytes: unknown, defaultValue: number): number {
  const value = sampleSizeBytes ?? defaultValue;

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw invalidOptionsError("Sample size must be a positive safe integer.", {
      option: "sampleSizeBytes",
      value,
    });
  }

  return value;
}

function resolveBooleanOption(input: unknown, defaultValue: boolean, option: string): boolean {
  if (input === undefined) {
    return defaultValue;
  }

  return normalizeBoolean(input, option);
}

function resolveSourceMapMode(input: unknown, defaultValue: SourceMapMode): SourceMapMode {
  if (input === undefined) {
    return defaultValue;
  }

  if (input !== "exact" && input !== "line" && input !== "none") {
    throw invalidOptionsError("sourceMap must be one of: exact, line, none.", {
      option: "sourceMap",
      value: input,
    });
  }

  return input;
}

function resolveReplacementPolicy(
  input: unknown,
  defaultValue: ReplacementPolicy,
): ReplacementPolicy {
  if (input === undefined) {
    return defaultValue;
  }

  if (input !== "fatal" && input !== "replace") {
    throw invalidOptionsError("replacementPolicy must be one of: fatal, replace.", {
      option: "replacementPolicy",
      value: input,
    });
  }

  return input;
}

function resolveReplacementCharacter(input: unknown, defaultValue: string): string {
  if (input === undefined) {
    return defaultValue;
  }

  if (typeof input !== "string" || input.length === 0) {
    throw invalidOptionsError("replacementCharacter must be a non-empty string.", {
      option: "replacementCharacter",
      valueType: typeof input,
      length: typeof input === "string" ? input.length : undefined,
    });
  }

  return input;
}

function resolveBackendPreference(
  backendPreference: readonly DecoderBackendName[] | undefined,
  defaultValue: readonly DecoderBackendName[],
): readonly DecoderBackendName[] {
  if (backendPreference === undefined) {
    return defaultValue;
  }

  if (!Array.isArray(backendPreference)) {
    throw invalidOptionsError("backendPreference must be an array.", {
      option: "backendPreference",
      valueType: typeof backendPreference,
    });
  }

  const normalized: DecoderBackendName[] = [];

  for (const backendName of backendPreference) {
    if (!isDecoderBackendName(backendName)) {
      throw invalidOptionsError("Unsupported decoder backend.", {
        option: "backendPreference",
        backend: backendName,
      });
    }

    if (!normalized.includes(backendName)) {
      normalized.push(backendName);
    }
  }

  if (normalized.length === 0) {
    throw invalidOptionsError("backendPreference must contain at least one backend.", {
      option: "backendPreference",
    });
  }

  return Object.freeze(normalized);
}

function normalizeEncodingNameList(
  values: unknown,
  option: string,
  options: { readonly allowEmpty: boolean },
): readonly RelicMEMEncodingName[] {
  if (!Array.isArray(values)) {
    throw invalidOptionsError("Encoding list option must be an array.", {
      option,
      valueType: typeof values,
    });
  }

  const normalized: RelicMEMEncodingName[] = [];

  for (const value of values) {
    const encoding = normalizeCanonicalEncoding(value, option);

    if (!normalized.includes(encoding)) {
      normalized.push(encoding);
    }
  }

  if (!options.allowEmpty && normalized.length === 0) {
    throw invalidOptionsError("Encoding list option must not be empty.", {
      option,
    });
  }

  return Object.freeze(normalized);
}

function normalizeCanonicalEncoding(value: unknown, option: string): RelicMEMEncodingName {
  if (typeof value !== "string" || !isRelicMEMEncodingName(value)) {
    throw invalidOptionsError("Unsupported canonical encoding.", {
      option,
      encoding: value,
    });
  }

  return value;
}

function assertEncodingSubset(
  values: readonly RelicMEMEncodingName[],
  allowedEncodings: readonly RelicMEMEncodingName[],
  option: string,
): void {
  for (const encoding of values) {
    assertEncodingAllowed(encoding, allowedEncodings, option);
  }
}

function assertEncodingAllowed(
  encoding: RelicMEMEncodingName,
  allowedEncodings: readonly RelicMEMEncodingName[],
  option: string,
): void {
  if (!allowedEncodings.includes(encoding)) {
    throw invalidOptionsError("Encoding is not allowed by the active options.", {
      option,
      encoding,
      allowedEncodings,
    });
  }
}

function normalizeOptionalString(value: unknown, option: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw invalidOptionsError("Metadata fields must be strings when provided.", {
      option,
      valueType: typeof value,
    });
  }

  return value;
}

function normalizeBoolean(value: unknown, option: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidOptionsError("Boolean option must be a boolean.", {
      option,
      valueType: typeof value,
    });
  }

  return value;
}

function normalizeOptionsObject<TOptions extends object>(
  options: TOptions | undefined,
  label: string,
): TOptions;
function normalizeOptionsObject(options: unknown, label: string): object {
  if (options === undefined) {
    return {};
  }

  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw invalidOptionsError(`${label} must be an object.`, {
      option: "options",
      valueType: typeof options,
    });
  }

  return options;
}

function isDecoderBackendName(value: unknown): value is DecoderBackendName {
  return typeof value === "string" && DECODER_BACKEND_NAMES.includes(value as DecoderBackendName);
}

function invalidOptionsError(message: string, details: Readonly<Record<string, unknown>>) {
  return createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message,
    details,
  });
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
