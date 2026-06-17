import type { DecoderBackendName } from "../contracts/backend.js";
import { createEncodingError } from "../contracts/diagnostics.js";
import type {
  ReplacementPolicy,
  RmemEncodingName,
  RmemEncodingProfileName,
  SourceMapMode,
} from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { RMEM_ENCODING_NAMES, isRmemEncodingName } from "../encoding/EncodingRegistry.js";

export interface EncodingProfilePolicy {
  readonly profile: EncodingProfile;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
  readonly backendPreference: readonly DecoderBackendName[];
  readonly sampleSizeBytes: number;
}

export const DEFAULT_ENCODING_PROFILE_NAME = "rmem" as const satisfies RmemEncodingProfileName;
export const DEFAULT_REPLACEMENT_CHARACTER = "\uFFFD";
export const DEFAULT_SAMPLE_SIZE_BYTES = 64 * 1024;

export const SINGLE_BYTE_ENCODINGS = Object.freeze([
  "windows-1251",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-5",
  "koi8-r",
  "cp866",
] as const satisfies readonly RmemEncodingName[]);

export const ASCII_COMPATIBLE_ENCODINGS = Object.freeze([
  "utf-8",
  ...SINGLE_BYTE_ENCODINGS,
] as const satisfies readonly RmemEncodingName[]);

export const LEGACY_CYRILLIC_ENCODINGS = Object.freeze([
  "utf-8",
  "windows-1251",
  "koi8-r",
  "cp866",
  "iso-8859-5",
] as const satisfies readonly RmemEncodingName[]);

export const STRICT_UTF8_PROFILE = freezeEncodingProfile({
  name: "strictUtf8",
  allowedEncodings: ["utf-8"],
  asciiCompatibleEncodings: ["utf-8"],
  nativeByteSafeEncodings: ["utf-8"],
  defaultEncoding: "utf-8",
  minConfidence: 1,
  legacyHeuristics: false,
  utf16Heuristics: false,
  metadataSniffing: false,
});

export const RMEM_PROFILE = freezeEncodingProfile({
  name: "rmem",
  allowedEncodings: RMEM_ENCODING_NAMES,
  asciiCompatibleEncodings: ASCII_COMPATIBLE_ENCODINGS,
  nativeByteSafeEncodings: ASCII_COMPATIBLE_ENCODINGS,
  defaultEncoding: "utf-8",
  minConfidence: 0.75,
  legacyHeuristics: true,
  utf16Heuristics: true,
  metadataSniffing: false,
});

export const LEGACY_CYRILLIC_PROFILE = freezeEncodingProfile({
  name: "legacyCyrillic",
  allowedEncodings: LEGACY_CYRILLIC_ENCODINGS,
  asciiCompatibleEncodings: LEGACY_CYRILLIC_ENCODINGS,
  nativeByteSafeEncodings: LEGACY_CYRILLIC_ENCODINGS,
  defaultEncoding: "windows-1251",
  minConfidence: 0.6,
  legacyHeuristics: true,
  utf16Heuristics: false,
  metadataSniffing: false,
});

export const WEB_COMPAT_PROFILE = freezeEncodingProfile({
  name: "webCompat",
  allowedEncodings: RMEM_ENCODING_NAMES,
  asciiCompatibleEncodings: ASCII_COMPATIBLE_ENCODINGS,
  nativeByteSafeEncodings: ASCII_COMPATIBLE_ENCODINGS,
  defaultEncoding: "windows-1252",
  minConfidence: 0.5,
  legacyHeuristics: true,
  utf16Heuristics: true,
  metadataSniffing: true,
});

export const BUILT_IN_ENCODING_PROFILES: Readonly<
  Record<RmemEncodingProfileName, EncodingProfile>
> = Object.freeze({
  strictUtf8: STRICT_UTF8_PROFILE,
  rmem: RMEM_PROFILE,
  legacyCyrillic: LEGACY_CYRILLIC_PROFILE,
  webCompat: WEB_COMPAT_PROFILE,
});

export const BUILT_IN_ENCODING_PROFILE_POLICIES: Readonly<
  Record<RmemEncodingProfileName, EncodingProfilePolicy>
> = Object.freeze({
  strictUtf8: createProfilePolicy({
    profile: STRICT_UTF8_PROFILE,
    stripBom: true,
    sourceMap: "exact",
    replacementPolicy: "fatal",
    replacementCharacter: DEFAULT_REPLACEMENT_CHARACTER,
    backendPreference: ["native", "text-decoder"],
    sampleSizeBytes: DEFAULT_SAMPLE_SIZE_BYTES,
  }),
  rmem: createProfilePolicy({
    profile: RMEM_PROFILE,
    stripBom: true,
    sourceMap: "exact",
    replacementPolicy: "fatal",
    replacementCharacter: DEFAULT_REPLACEMENT_CHARACTER,
    backendPreference: ["native", "text-decoder", "iconv-lite", "exodus-bytes"],
    sampleSizeBytes: DEFAULT_SAMPLE_SIZE_BYTES,
  }),
  legacyCyrillic: createProfilePolicy({
    profile: LEGACY_CYRILLIC_PROFILE,
    stripBom: true,
    sourceMap: "exact",
    replacementPolicy: "replace",
    replacementCharacter: DEFAULT_REPLACEMENT_CHARACTER,
    backendPreference: ["native", "iconv-lite", "text-decoder"],
    sampleSizeBytes: DEFAULT_SAMPLE_SIZE_BYTES,
  }),
  webCompat: createProfilePolicy({
    profile: WEB_COMPAT_PROFILE,
    stripBom: true,
    sourceMap: "exact",
    replacementPolicy: "replace",
    replacementCharacter: DEFAULT_REPLACEMENT_CHARACTER,
    backendPreference: ["text-decoder", "exodus-bytes", "native", "iconv-lite"],
    sampleSizeBytes: DEFAULT_SAMPLE_SIZE_BYTES,
  }),
});

export function resolveEncodingProfilePolicy(
  profile?: RmemEncodingProfileName | EncodingProfile,
): EncodingProfilePolicy;
export function resolveEncodingProfilePolicy(profile?: unknown): EncodingProfilePolicy {
  if (profile === undefined) {
    return BUILT_IN_ENCODING_PROFILE_POLICIES[DEFAULT_ENCODING_PROFILE_NAME];
  }

  if (typeof profile === "string") {
    if (isBuiltInEncodingProfileName(profile)) {
      return BUILT_IN_ENCODING_PROFILE_POLICIES[profile];
    }

    throw invalidProfileError("Unsupported encoding profile.", {
      option: "profile",
      profile,
    });
  }

  if (typeof profile === "object" && profile !== null && !Array.isArray(profile)) {
    return createProfilePolicy({
      profile: normalizeCustomEncodingProfile(profile),
      stripBom: true,
      sourceMap: "exact",
      replacementPolicy: "fatal",
      replacementCharacter: DEFAULT_REPLACEMENT_CHARACTER,
      backendPreference: ["native", "text-decoder", "iconv-lite", "exodus-bytes"],
      sampleSizeBytes: DEFAULT_SAMPLE_SIZE_BYTES,
    });
  }

  throw invalidProfileError("Encoding profile must be a profile name or profile object.", {
    option: "profile",
    valueType: typeof profile,
  });
}

export function normalizeCustomEncodingProfile(profile: object): EncodingProfile {
  const profileRecord = profile as Partial<EncodingProfile>;
  const name = normalizeNonEmptyString(profileRecord.name, "profile.name");
  const allowedEncodings = normalizeEncodingNameList(
    profileRecord.allowedEncodings,
    "profile.allowedEncodings",
    { allowEmpty: false },
  );
  const asciiCompatibleEncodings = normalizeEncodingNameList(
    profileRecord.asciiCompatibleEncodings,
    "profile.asciiCompatibleEncodings",
    { allowEmpty: true },
  );
  const nativeByteSafeEncodings = normalizeEncodingNameList(
    profileRecord.nativeByteSafeEncodings,
    "profile.nativeByteSafeEncodings",
    { allowEmpty: true },
  );
  const defaultEncoding = normalizeCanonicalEncoding(
    profileRecord.defaultEncoding,
    "profile.defaultEncoding",
  );
  const minConfidence = normalizeMinConfidence(
    profileRecord.minConfidence,
    "profile.minConfidence",
  );
  const legacyHeuristics = normalizeBoolean(
    profileRecord.legacyHeuristics,
    "profile.legacyHeuristics",
  );
  const utf16Heuristics = normalizeBoolean(
    profileRecord.utf16Heuristics,
    "profile.utf16Heuristics",
  );
  const metadataSniffing = normalizeBoolean(
    profileRecord.metadataSniffing,
    "profile.metadataSniffing",
  );

  assertEncodingAllowed(defaultEncoding, allowedEncodings, "profile.defaultEncoding");
  assertEncodingSubset(
    asciiCompatibleEncodings,
    allowedEncodings,
    "profile.asciiCompatibleEncodings",
  );
  assertEncodingSubset(
    nativeByteSafeEncodings,
    allowedEncodings,
    "profile.nativeByteSafeEncodings",
  );

  return freezeEncodingProfile({
    name,
    allowedEncodings,
    asciiCompatibleEncodings,
    nativeByteSafeEncodings,
    defaultEncoding,
    minConfidence,
    legacyHeuristics,
    utf16Heuristics,
    metadataSniffing,
  });
}

export function isBuiltInEncodingProfileName(value: string): value is RmemEncodingProfileName {
  return (
    value === "strictUtf8" ||
    value === "rmem" ||
    value === "legacyCyrillic" ||
    value === "webCompat"
  );
}

export function freezeEncodingProfile(profile: EncodingProfile): EncodingProfile {
  return Object.freeze({
    name: profile.name,
    allowedEncodings: Object.freeze([...profile.allowedEncodings]),
    asciiCompatibleEncodings: Object.freeze([...profile.asciiCompatibleEncodings]),
    nativeByteSafeEncodings: Object.freeze([...profile.nativeByteSafeEncodings]),
    defaultEncoding: profile.defaultEncoding,
    minConfidence: profile.minConfidence,
    legacyHeuristics: profile.legacyHeuristics,
    utf16Heuristics: profile.utf16Heuristics,
    metadataSniffing: profile.metadataSniffing,
  });
}

function createProfilePolicy(options: {
  readonly profile: EncodingProfile;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
  readonly backendPreference: readonly DecoderBackendName[];
  readonly sampleSizeBytes: number;
}): EncodingProfilePolicy {
  return Object.freeze({
    profile: freezeEncodingProfile(options.profile),
    stripBom: options.stripBom,
    sourceMap: options.sourceMap,
    replacementPolicy: options.replacementPolicy,
    replacementCharacter: options.replacementCharacter,
    backendPreference: Object.freeze([...options.backendPreference]),
    sampleSizeBytes: options.sampleSizeBytes,
  });
}

function normalizeEncodingNameList(
  values: unknown,
  option: string,
  options: { readonly allowEmpty: boolean },
): readonly RmemEncodingName[] {
  if (!Array.isArray(values)) {
    throw invalidProfileError("Encoding list option must be an array.", {
      option,
      valueType: typeof values,
    });
  }

  const normalized: RmemEncodingName[] = [];

  for (const value of values) {
    const encoding = normalizeCanonicalEncoding(value, option);

    if (!normalized.includes(encoding)) {
      normalized.push(encoding);
    }
  }

  if (!options.allowEmpty && normalized.length === 0) {
    throw invalidProfileError("Encoding list option must not be empty.", {
      option,
    });
  }

  return Object.freeze(normalized);
}

function normalizeCanonicalEncoding(value: unknown, option: string): RmemEncodingName {
  if (typeof value !== "string" || !isRmemEncodingName(value)) {
    throw invalidProfileError("Unsupported canonical encoding.", {
      option,
      encoding: value,
    });
  }

  return value;
}

function normalizeMinConfidence(value: unknown, option: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw invalidProfileError("Minimum confidence must be a number between 0 and 1.", {
      option,
      value,
    });
  }

  return value;
}

function assertEncodingSubset(
  values: readonly RmemEncodingName[],
  allowedEncodings: readonly RmemEncodingName[],
  option: string,
): void {
  for (const encoding of values) {
    assertEncodingAllowed(encoding, allowedEncodings, option);
  }
}

function assertEncodingAllowed(
  encoding: RmemEncodingName,
  allowedEncodings: readonly RmemEncodingName[],
  option: string,
): void {
  if (!allowedEncodings.includes(encoding)) {
    throw invalidProfileError("Encoding is not allowed by the active profile.", {
      option,
      encoding,
      allowedEncodings,
    });
  }
}

function normalizeNonEmptyString(value: unknown, option: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidProfileError("String option must be a non-empty string.", {
      option,
      valueType: typeof value,
      length: typeof value === "string" ? value.length : undefined,
    });
  }

  return value;
}

function normalizeBoolean(value: unknown, option: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidProfileError("Boolean option must be a boolean.", {
      option,
      valueType: typeof value,
    });
  }

  return value;
}

function invalidProfileError(message: string, details: Readonly<Record<string, unknown>>) {
  return createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message,
    details,
  });
}
