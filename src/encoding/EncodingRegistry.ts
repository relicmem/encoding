import type {
  NormalizedEncodingLabel,
  NormalizedEncodingLabelSource,
} from "../contracts/detection.js";
import {
  createEncodingError,
  encodingFailure,
  encodingSuccess,
  isEncodingError,
} from "../contracts/diagnostics.js";
import type { EncodingResult } from "../contracts/diagnostics.js";
import type { RelicMEMEncodingName, RelicMEMEncodingProfileName } from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";

export type EncodingLabelCompatibility = "strict" | "web";

export interface NormalizeEncodingLabelOptions {
  readonly source?: NormalizedEncodingLabelSource;
  readonly profile?: RelicMEMEncodingProfileName | EncodingProfile;
  readonly compatibility?: EncodingLabelCompatibility;
}

export interface EncodingAliasLookupOptions {
  readonly profile?: RelicMEMEncodingProfileName | EncodingProfile;
  readonly compatibility?: EncodingLabelCompatibility;
}

interface EncodingRegistryEntry {
  readonly canonical: RelicMEMEncodingName;
  readonly aliases: readonly string[];
}

interface WebCompatRemap {
  readonly labels: readonly string[];
  readonly canonical: RelicMEMEncodingName;
}

export const RELICMEM_ENCODING_NAMES = Object.freeze([
  "utf-8",
  "utf-16le",
  "utf-16be",
  "windows-1251",
  "windows-1252",
  "iso-8859-1",
  "iso-8859-5",
  "koi8-r",
  "cp866",
] as const satisfies readonly RelicMEMEncodingName[]);

const NORMALIZED_LABEL_SOURCES = Object.freeze([
  "explicit",
  "metadata",
  "bom",
  "profile",
  "default",
] as const satisfies readonly NormalizedEncodingLabelSource[]);

const ENCODING_REGISTRY = Object.freeze([
  registryEntry("utf-8", ["utf8", "unicode-1-1-utf-8"]),
  registryEntry("utf-16le", ["utf16le", "utf-16-le", "utf-16 little endian"]),
  registryEntry("utf-16be", ["utf16be", "utf-16-be", "utf-16 big endian"]),
  registryEntry("windows-1251", ["cp1251", "windows1251", "win1251", "x-cp1251"]),
  registryEntry("windows-1252", ["cp1252", "windows1252", "win1252", "x-cp1252"]),
  registryEntry("iso-8859-1", ["iso8859-1", "iso88591", "iso-8859-1:1987", "latin1", "l1"]),
  registryEntry("iso-8859-5", ["iso8859-5", "iso88595", "iso-8859-5:1988", "cyrillic"]),
  registryEntry("koi8-r", ["koi8r", "koi-8-r", "cskoi8r"]),
  registryEntry("cp866", ["cp-866", "866", "ibm866", "csibm866"]),
] as const satisfies readonly EncodingRegistryEntry[]);

const WEB_COMPAT_REMAPS = Object.freeze([
  {
    labels: Object.freeze([
      "ansi-x3.4-1968",
      "ascii",
      "cp819",
      "csisolatin1",
      "ibm819",
      "iso-8859-1",
      "iso-8859-1:1987",
      "iso-ir-100",
      "iso8859-1",
      "iso88591",
      "latin1",
      "l1",
      "us-ascii",
    ]),
    canonical: "windows-1252",
  },
] as const satisfies readonly WebCompatRemap[]);

const STRICT_LABELS = buildLabelLookup(ENCODING_REGISTRY, []);
const WEB_COMPAT_LABELS = buildLabelLookup(ENCODING_REGISTRY, WEB_COMPAT_REMAPS);
const STRICT_ALIASES = buildAliasLookup(ENCODING_REGISTRY, []);
const WEB_COMPAT_ALIASES = buildAliasLookup(ENCODING_REGISTRY, WEB_COMPAT_REMAPS);

export function normalizeEncodingLabel(
  label: string,
  options?: NormalizeEncodingLabelOptions,
): NormalizedEncodingLabel {
  const normalizedOptions = normalizeEncodingLabelOptions(options);
  const normalizedLabel = normalizeLabelKey(label);
  const compatibility = resolveCompatibility(normalizedOptions);
  const canonical = resolveCanonicalEncoding(normalizedLabel, compatibility, normalizedOptions);

  return createNormalizedEncodingLabel({
    inputLabel: label,
    canonical,
    aliases: aliasesForEncoding(canonical, { compatibility }),
    source: normalizedOptions.source,
  });
}

export function tryNormalizeEncodingLabel(
  label: string,
  options?: NormalizeEncodingLabelOptions,
): EncodingResult<NormalizedEncodingLabel> {
  try {
    return encodingSuccess(normalizeEncodingLabel(label, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

export function isRelicMEMEncodingName(value: string): value is RelicMEMEncodingName {
  return RELICMEM_ENCODING_NAMES.includes(value as RelicMEMEncodingName);
}

export function aliasesForEncoding(
  encoding: string,
  options?: EncodingAliasLookupOptions,
): readonly string[] {
  if (!isRelicMEMEncodingName(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Unsupported encoding.",
      details: { encoding },
    });
  }

  const compatibility = resolveCompatibility(normalizeAliasLookupOptions(options));
  const aliases = (compatibility === "web" ? WEB_COMPAT_ALIASES : STRICT_ALIASES).get(encoding);

  if (aliases === undefined) {
    return Object.freeze([]);
  }

  return aliases;
}

function createNormalizedEncodingLabel(options: {
  readonly inputLabel: string;
  readonly canonical: RelicMEMEncodingName;
  readonly aliases: readonly string[];
  readonly source: NormalizedEncodingLabelSource;
}): NormalizedEncodingLabel {
  return Object.freeze({
    inputLabel: options.inputLabel,
    canonical: options.canonical,
    aliases: Object.freeze([...options.aliases]),
    source: options.source,
  });
}

function normalizeEncodingLabelOptions(
  options: unknown,
): Required<Pick<NormalizeEncodingLabelOptions, "source">> &
  Pick<NormalizeEncodingLabelOptions, "profile" | "compatibility"> {
  if (options === undefined) {
    return { source: "explicit" };
  }

  if (typeof options !== "object" || options === null) {
    throw new TypeError("Encoding label normalization options must be an object.");
  }

  const normalizationOptions = options as NormalizeEncodingLabelOptions;
  const source = normalizationOptions.source ?? "explicit";
  assertNormalizedEncodingLabelSource(source);
  assertEncodingLabelCompatibility(normalizationOptions.compatibility);

  return {
    source,
    ...(normalizationOptions.profile === undefined
      ? {}
      : { profile: normalizationOptions.profile }),
    ...(normalizationOptions.compatibility === undefined
      ? {}
      : { compatibility: normalizationOptions.compatibility }),
  };
}

function normalizeAliasLookupOptions(
  options: unknown,
): Pick<NormalizeEncodingLabelOptions, "profile" | "compatibility"> {
  if (options === undefined) {
    return {};
  }

  if (typeof options !== "object" || options === null) {
    throw new TypeError("Encoding alias lookup options must be an object.");
  }

  const aliasLookupOptions = options as EncodingAliasLookupOptions;
  assertEncodingLabelCompatibility(aliasLookupOptions.compatibility);

  return {
    ...(aliasLookupOptions.profile === undefined ? {} : { profile: aliasLookupOptions.profile }),
    ...(aliasLookupOptions.compatibility === undefined
      ? {}
      : { compatibility: aliasLookupOptions.compatibility }),
  };
}

function resolveCanonicalEncoding(
  normalizedLabel: string,
  compatibility: EncodingLabelCompatibility,
  options: Required<Pick<NormalizeEncodingLabelOptions, "source">> &
    Pick<NormalizeEncodingLabelOptions, "profile" | "compatibility">,
): RelicMEMEncodingName {
  const labelLookup = compatibility === "web" ? WEB_COMPAT_LABELS : STRICT_LABELS;
  const canonical = labelLookup.get(normalizedLabel);

  if (canonical !== undefined) {
    return canonical;
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_LABEL",
    message: "Unsupported encoding label.",
    details: {
      label: normalizedLabel,
      source: options.source,
      compatibility,
    },
  });
}

function normalizeLabelKey(label: unknown): string {
  if (typeof label !== "string") {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_LABEL",
      message: "Encoding label must be a string.",
      details: { labelType: typeof label },
    });
  }

  const normalizedLabel = label.trim().toLowerCase().replaceAll("_", "-");

  if (normalizedLabel.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_LABEL",
      message: "Encoding label must not be empty.",
    });
  }

  return normalizedLabel;
}

function resolveCompatibility(
  options: Pick<NormalizeEncodingLabelOptions, "profile" | "compatibility">,
): EncodingLabelCompatibility {
  if (options.compatibility !== undefined) {
    return options.compatibility;
  }

  return isWebCompatProfile(options.profile) ? "web" : "strict";
}

function isWebCompatProfile(
  profile: RelicMEMEncodingProfileName | EncodingProfile | undefined,
): boolean {
  if (profile === undefined) {
    return false;
  }

  if (typeof profile === "string") {
    return profile === "webCompat";
  }

  return profile.name === "webCompat";
}

function assertNormalizedEncodingLabelSource(
  source: unknown,
): asserts source is NormalizedEncodingLabelSource {
  if (
    typeof source !== "string" ||
    !NORMALIZED_LABEL_SOURCES.includes(source as NormalizedEncodingLabelSource)
  ) {
    throw new RangeError(
      "Encoding label source must be one of: explicit, metadata, bom, profile, default.",
    );
  }
}

function assertEncodingLabelCompatibility(
  compatibility: unknown,
): asserts compatibility is EncodingLabelCompatibility | undefined {
  if (compatibility !== undefined && compatibility !== "strict" && compatibility !== "web") {
    throw new RangeError("Encoding label compatibility must be one of: strict, web.");
  }
}

function buildLabelLookup(
  registry: readonly EncodingRegistryEntry[],
  remaps: readonly WebCompatRemap[],
): ReadonlyMap<string, RelicMEMEncodingName> {
  const labels = new Map<string, RelicMEMEncodingName>();

  for (const entry of registry) {
    labels.set(entry.canonical, entry.canonical);

    for (const alias of entry.aliases) {
      labels.set(normalizeLabelKey(alias), entry.canonical);
    }
  }

  for (const remap of remaps) {
    for (const label of remap.labels) {
      labels.set(normalizeLabelKey(label), remap.canonical);
    }
  }

  return labels;
}

function buildAliasLookup(
  registry: readonly EncodingRegistryEntry[],
  remaps: readonly WebCompatRemap[],
): ReadonlyMap<RelicMEMEncodingName, readonly string[]> {
  const aliases = new Map<RelicMEMEncodingName, string[]>();

  for (const entry of registry) {
    aliases.set(entry.canonical, [...entry.aliases]);
  }

  for (const remap of remaps) {
    const canonicalAliases = aliases.get(remap.canonical) ?? [];
    const mergedAliases = [...canonicalAliases];

    for (const label of remap.labels) {
      const normalizedLabel = normalizeLabelKey(label);

      if (normalizedLabel !== remap.canonical && !mergedAliases.includes(normalizedLabel)) {
        mergedAliases.push(normalizedLabel);
      }
    }

    aliases.set(remap.canonical, mergedAliases);
  }

  return new Map(
    [...aliases.entries()].map(([encoding, encodingAliases]) => [
      encoding,
      Object.freeze(encodingAliases),
    ]),
  );
}

function registryEntry(
  canonical: RelicMEMEncodingName,
  aliases: readonly string[],
): EncodingRegistryEntry {
  return Object.freeze({
    canonical,
    aliases: Object.freeze(aliases.map((alias) => normalizeLabelKey(alias))),
  });
}
