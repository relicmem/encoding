import {
  DECODER_BACKEND_NAMES,
  type DecoderBackend,
  type DecoderBackendInfo,
  type DecoderBackendName,
} from "../contracts/backend.js";
import {
  createEncodingError,
  createEncodingWarning,
  freezeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingDiagnosticCode, EncodingWarning } from "../contracts/diagnostics.js";
import type { RmemEncodingName, SourceMapMode } from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { isRmemEncodingName } from "../encoding/EncodingRegistry.js";

export type DecoderBackendSkipReason =
  | "not-registered"
  | "decode-unsupported"
  | "exact-source-map-unavailable";

export interface SelectDecoderBackendOptions {
  readonly encoding: RmemEncodingName;
  readonly profile: EncodingProfile;
  readonly sourceMap: SourceMapMode;
  readonly backendPreference: readonly DecoderBackendName[];
}

export interface DecoderBackendSelectionSkip {
  readonly backend: DecoderBackendName;
  readonly reason: DecoderBackendSkipReason;
  readonly info?: DecoderBackendInfo;
}

export interface DecoderBackendSelection {
  readonly backend: DecoderBackend;
  readonly info: DecoderBackendInfo;
  readonly warnings: readonly EncodingWarning[];
  readonly skippedBackends: readonly DecoderBackendSelectionSkip[];
}

interface RegisteredDecoderBackend {
  readonly backend: DecoderBackend;
  readonly info: DecoderBackendInfo;
}

interface NormalizedSelectionOptions {
  readonly encoding: RmemEncodingName;
  readonly profileName: string;
  readonly sourceMap: SourceMapMode;
  readonly backendPreference: readonly DecoderBackendName[];
}

export class DecoderRegistry {
  private readonly backendEntries: readonly RegisteredDecoderBackend[];
  private readonly backendsByName: ReadonlyMap<DecoderBackendName, RegisteredDecoderBackend>;

  constructor(backends: readonly DecoderBackend[] = []) {
    const entries = createRegisteredBackendEntries(backends);

    this.backendEntries = entries;
    this.backendsByName = new Map(entries.map((entry) => [entry.info.name, entry]));

    Object.freeze(this);
  }

  hasBackend(name: DecoderBackendName): boolean {
    return this.backendsByName.has(name);
  }

  getBackend(name: DecoderBackendName): DecoderBackend | undefined {
    return this.backendsByName.get(name)?.backend;
  }

  getBackendInfo(name: DecoderBackendName): DecoderBackendInfo | undefined {
    return this.backendsByName.get(name)?.info;
  }

  listBackendInfo(): readonly DecoderBackendInfo[] {
    return Object.freeze(
      DECODER_BACKEND_NAMES.flatMap((name) => {
        const entry = this.backendsByName.get(name);

        return entry === undefined ? [] : [entry.info];
      }),
    );
  }

  register(backend: DecoderBackend): DecoderRegistry {
    return new DecoderRegistry([...this.backendEntries.map((entry) => entry.backend), backend]);
  }

  selectDecoderBackend(options: SelectDecoderBackendOptions): DecoderBackendSelection {
    const normalizedOptions = normalizeSelectionOptions(options);
    const skippedBackends: DecoderBackendSelectionSkip[] = [];

    for (const backendName of normalizedOptions.backendPreference) {
      const entry = this.backendsByName.get(backendName);

      if (entry === undefined) {
        skippedBackends.push(createSkippedBackend(backendName, "not-registered"));
        continue;
      }

      if (!entry.backend.canDecode(normalizedOptions.encoding)) {
        skippedBackends.push(createSkippedBackend(backendName, "decode-unsupported", entry.info));
        continue;
      }

      if (requiresExactSourceMap(normalizedOptions.sourceMap) && !entry.info.exactSourceMap) {
        skippedBackends.push(
          createSkippedBackend(backendName, "exact-source-map-unavailable", entry.info),
        );
        continue;
      }

      return createSelection(entry, normalizedOptions, skippedBackends);
    }

    throw createSelectionError(normalizedOptions, skippedBackends);
  }
}

export const EMPTY_DECODER_REGISTRY = new DecoderRegistry();

export function createDecoderRegistry(backends: readonly DecoderBackend[] = []): DecoderRegistry {
  return new DecoderRegistry(backends);
}

function createRegisteredBackendEntries(
  backends: readonly DecoderBackend[],
): readonly RegisteredDecoderBackend[] {
  if (!Array.isArray(backends)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backends must be provided as an array.",
      details: {
        valueType: typeof backends,
      },
    });
  }

  const entries: RegisteredDecoderBackend[] = [];
  const seenNames = new Set<DecoderBackendName>();

  for (const backend of backends) {
    assertDecoderBackend(backend);

    const info = freezeDecoderBackendInfo(backend.info);

    if (seenNames.has(info.name)) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Duplicate decoder backend registration.",
        details: {
          backend: info.name,
        },
      });
    }

    seenNames.add(info.name);
    entries.push(
      Object.freeze({
        backend,
        info,
      }),
    );
  }

  return Object.freeze(entries);
}

function normalizeSelectionOptions(options: unknown): NormalizedSelectionOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend selection options must be an object.",
      details: {
        valueType: typeof options,
      },
    });
  }

  const selectionOptions = options as Partial<Record<keyof SelectDecoderBackendOptions, unknown>>;
  const encoding = normalizeEncoding(selectionOptions.encoding);
  const profileName = normalizeProfileName(selectionOptions.profile);
  const sourceMap = normalizeSourceMapMode(selectionOptions.sourceMap);
  const backendPreference = normalizeBackendPreference(selectionOptions.backendPreference);

  return Object.freeze({
    encoding,
    profileName,
    sourceMap,
    backendPreference,
  });
}

function normalizeEncoding(encoding: unknown): RmemEncodingName {
  if (typeof encoding !== "string" || !isRmemEncodingName(encoding)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend selection requires a supported canonical encoding.",
      details: {
        encoding,
      },
    });
  }

  return encoding;
}

function normalizeProfileName(profile: unknown): string {
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend selection requires a normalized encoding profile.",
      details: {
        valueType: typeof profile,
      },
    });
  }

  const profileName = (profile as Partial<EncodingProfile>).name;

  if (typeof profileName !== "string" || profileName.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend selection requires a named encoding profile.",
      details: {
        valueType: typeof profileName,
      },
    });
  }

  return profileName;
}

function normalizeSourceMapMode(sourceMap: unknown): SourceMapMode {
  if (sourceMap !== "exact" && sourceMap !== "line" && sourceMap !== "none") {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Decoder backend selection requires a valid source map mode.",
      details: {
        sourceMap,
      },
    });
  }

  return sourceMap;
}

function normalizeBackendPreference(backendPreference: unknown): readonly DecoderBackendName[] {
  if (!Array.isArray(backendPreference)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Backend preference must be an array.",
      details: {
        valueType: typeof backendPreference,
      },
    });
  }

  const normalized: DecoderBackendName[] = [];

  for (const backendName of backendPreference) {
    if (!isDecoderBackendName(backendName)) {
      throw createEncodingError({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "Unsupported decoder backend.",
        details: {
          backend: backendName,
        },
      });
    }

    if (!normalized.includes(backendName)) {
      normalized.push(backendName);
    }
  }

  if (normalized.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Backend preference must contain at least one backend.",
      details: {
        option: "backendPreference",
      },
    });
  }

  return Object.freeze(normalized);
}

function createSelection(
  entry: RegisteredDecoderBackend,
  options: NormalizedSelectionOptions,
  skippedBackends: readonly DecoderBackendSelectionSkip[],
): DecoderBackendSelection {
  const frozenSkippedBackends = freezeSkippedBackends(skippedBackends);

  return Object.freeze({
    backend: entry.backend,
    info: entry.info,
    warnings: freezeEncodingWarnings(
      createBackendSubstitutionWarnings(options, entry.info, frozenSkippedBackends),
    ),
    skippedBackends: frozenSkippedBackends,
  });
}

function createBackendSubstitutionWarnings(
  options: NormalizedSelectionOptions,
  selectedInfo: DecoderBackendInfo,
  skippedBackends: readonly DecoderBackendSelectionSkip[],
): readonly EncodingWarning[] {
  if (skippedBackends.length === 0) {
    return [];
  }

  const firstSkippedBackend = skippedBackends[0];

  return [
    createEncodingWarning({
      code: "ENCODING_BACKEND_SUBSTITUTION",
      message: "Decoder backend was substituted.",
      details: {
        encoding: options.encoding,
        profile: options.profileName,
        sourceMap: options.sourceMap,
        requestedBackend: firstSkippedBackend?.backend,
        selectedBackend: selectedInfo.name,
        reason: firstSkippedBackend?.reason,
        skippedBackends: freezeSkippedBackendDetails(skippedBackends),
      },
    }),
  ];
}

function createSelectionError(
  options: NormalizedSelectionOptions,
  skippedBackends: readonly DecoderBackendSelectionSkip[],
) {
  const hasSourceMapOnlyFailure = skippedBackends.some(
    (backend) => backend.reason === "exact-source-map-unavailable",
  );
  const code: EncodingDiagnosticCode = hasSourceMapOnlyFailure
    ? "ENCODING_SOURCE_MAP_UNAVAILABLE"
    : "ENCODING_UNSUPPORTED_ENCODING";
  const message = hasSourceMapOnlyFailure
    ? "No registered decoder backend can provide the requested source map."
    : "No registered decoder backend can decode the requested encoding.";

  return createEncodingError({
    code,
    message,
    details: {
      encoding: options.encoding,
      profile: options.profileName,
      sourceMap: options.sourceMap,
      exactSourceMapRequired: requiresExactSourceMap(options.sourceMap),
      requestedBackends: Object.freeze([...options.backendPreference]),
      skippedBackends: freezeSkippedBackendDetails(skippedBackends),
    },
  });
}

function createSkippedBackend(
  backend: DecoderBackendName,
  reason: DecoderBackendSkipReason,
  info?: DecoderBackendInfo,
): DecoderBackendSelectionSkip {
  return Object.freeze({
    backend,
    reason,
    ...optionalProperty("info", info),
  });
}

function freezeSkippedBackends(
  skippedBackends: readonly DecoderBackendSelectionSkip[],
): readonly DecoderBackendSelectionSkip[] {
  return Object.freeze(
    skippedBackends.map((skippedBackend) =>
      createSkippedBackend(skippedBackend.backend, skippedBackend.reason, skippedBackend.info),
    ),
  );
}

function freezeSkippedBackendDetails(
  skippedBackends: readonly DecoderBackendSelectionSkip[],
): readonly Readonly<Record<string, unknown>>[] {
  return Object.freeze(
    skippedBackends.map((skippedBackend) =>
      Object.freeze({
        backend: skippedBackend.backend,
        reason: skippedBackend.reason,
        ...optionalProperty("exactSourceMap", skippedBackend.info?.exactSourceMap),
      }),
    ),
  );
}

function freezeDecoderBackendInfo(info: DecoderBackendInfo): DecoderBackendInfo {
  const version = normalizeOptionalVersion(info.version);

  return Object.freeze({
    name: normalizeBackendName(info.name),
    ...optionalProperty("version", version),
    exactSourceMap: normalizeExactSourceMap(info.exactSourceMap),
  });
}

function normalizeBackendName(name: unknown): DecoderBackendName {
  if (!isDecoderBackendName(name)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Unsupported decoder backend.",
      details: {
        backend: name,
      },
    });
  }

  return name;
}

function normalizeOptionalVersion(version: unknown): string | undefined {
  if (version === undefined) {
    return undefined;
  }

  if (typeof version !== "string" || version.length === 0) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend version must be a non-empty string.",
      details: {
        version,
      },
    });
  }

  return version;
}

function normalizeExactSourceMap(exactSourceMap: unknown): boolean {
  if (typeof exactSourceMap !== "boolean") {
    throw createEncodingError({
      code: "ENCODING_SOURCE_MAP_UNAVAILABLE",
      message: "Decoder backend exactSourceMap capability must be a boolean.",
      details: {
        valueType: typeof exactSourceMap,
      },
    });
  }

  return exactSourceMap;
}

function requiresExactSourceMap(sourceMap: SourceMapMode): boolean {
  return sourceMap !== "none";
}

function assertDecoderBackend(backend: unknown): asserts backend is DecoderBackend {
  if (typeof backend !== "object" || backend === null || Array.isArray(backend)) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend must be an object.",
      details: {
        valueType: typeof backend,
      },
    });
  }

  const candidate = backend as {
    readonly info?: unknown;
    readonly canDecode?: unknown;
    readonly canEncode?: unknown;
    readonly decode?: unknown;
    readonly encode?: unknown;
  };

  if (typeof candidate.info !== "object" || candidate.info === null) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend requires info metadata.",
    });
  }

  if (
    typeof candidate.canDecode !== "function" ||
    typeof candidate.canEncode !== "function" ||
    typeof candidate.decode !== "function" ||
    typeof candidate.encode !== "function"
  ) {
    throw createEncodingError({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Decoder backend must implement the full backend contract.",
    });
  }
}

function isDecoderBackendName(value: unknown): value is DecoderBackendName {
  return typeof value === "string" && DECODER_BACKEND_NAMES.includes(value as DecoderBackendName);
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
