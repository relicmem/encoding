import type { DecoderBackendName } from "./backend.js";
import type { DecodedDocument } from "./document.js";
import type { EncodingResult } from "./diagnostics.js";
import type { EncodingDetectionResult } from "./detection.js";
import type { EncodingProfile } from "./profile.js";

export type RelicMEMEncodingName =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "windows-1251"
  | "windows-1252"
  | "iso-8859-1"
  | "iso-8859-5"
  | "koi8-r"
  | "cp866";

export type RelicMEMEncodingProfileName =
  | "strictUtf8"
  | "relicmem"
  | "legacyCyrillic"
  | "webCompat";

export type SourceMapMode = "exact" | "line" | "none";

export type ReplacementPolicy = "fatal" | "replace";

export type EncodingInput =
  | string
  | Uint8Array
  | ArrayBuffer
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>;

export type SyncEncodingInput = string | Uint8Array | ArrayBuffer | Iterable<Uint8Array>;

export interface EncodingMetadata {
  readonly declaredEncoding?: string;
  readonly contentType?: string;
  readonly htmlHeadSample?: string;
  readonly sourceName?: string;
}

export interface DecodeDocumentOptions {
  readonly profile?: RelicMEMEncodingProfileName | EncodingProfile;
  readonly explicitEncoding?: string;
  readonly defaultEncoding?: RelicMEMEncodingName;
  readonly allowedEncodings?: readonly RelicMEMEncodingName[];
  readonly minConfidence?: number;
  readonly metadata?: EncodingMetadata;
  readonly stripBom?: boolean;
  readonly sourceMap?: SourceMapMode;
  readonly replacementPolicy?: ReplacementPolicy;
  readonly replacementCharacter?: string;
  readonly backendPreference?: readonly DecoderBackendName[];
  readonly sampleSizeBytes?: number;
}

export interface DetectEncodingOptions {
  readonly profile?: RelicMEMEncodingProfileName | EncodingProfile;
  readonly explicitEncoding?: string;
  readonly defaultEncoding?: RelicMEMEncodingName;
  readonly allowedEncodings?: readonly RelicMEMEncodingName[];
  readonly minConfidence?: number;
  readonly metadata?: EncodingMetadata;
  readonly sampleSizeBytes?: number;
}

export type DecodeDocumentFunction = (
  input: EncodingInput,
  options?: DecodeDocumentOptions,
) => Promise<DecodedDocument>;

export type DecodeDocumentSyncFunction = (
  input: SyncEncodingInput,
  options?: DecodeDocumentOptions,
) => DecodedDocument;

export type TryDecodeDocumentFunction = (
  input: EncodingInput,
  options?: DecodeDocumentOptions,
) => Promise<EncodingResult<DecodedDocument>>;

export type DetectEncodingFunction = (
  input: Uint8Array,
  options?: DetectEncodingOptions,
) => EncodingDetectionResult;
