import type { RelicMEMEncodingName, ReplacementPolicy, SourceMapMode } from "./encoding.js";
import type { EncodingWarning } from "./diagnostics.js";
import type { OffsetMap, OffsetMapSegment } from "./source.js";

export const DECODER_BACKEND_NAMES = Object.freeze([
  "native",
  "text-decoder",
  "iconv-lite",
  "exodus-bytes",
] as const);

export type DecoderBackendName = (typeof DECODER_BACKEND_NAMES)[number];

export interface DecoderBackendInfo {
  readonly name: DecoderBackendName;
  readonly version?: string;
  readonly exactSourceMap: boolean;
}

export interface BackendDecodeOptions {
  readonly encoding: RelicMEMEncodingName;
  readonly stripBom: boolean;
  readonly sourceMap: SourceMapMode;
  readonly replacementPolicy: ReplacementPolicy;
  readonly replacementCharacter: string;
}

export interface BackendDecodeResult {
  readonly text: string;
  readonly warnings: readonly EncodingWarning[];
  readonly offsetMap?: OffsetMap;
  readonly offsetMapSegments?: readonly OffsetMapSegment[];
}

export interface EncodeOptions {
  readonly replacementPolicy?: ReplacementPolicy;
  readonly replacementCharacter?: string;
}

export interface EncodeResult {
  readonly bytes: Uint8Array;
  readonly warnings: readonly EncodingWarning[];
}

export interface DecoderBackend {
  readonly info: DecoderBackendInfo;
  canDecode(encoding: RelicMEMEncodingName): boolean;
  canEncode(encoding: RelicMEMEncodingName): boolean;
  decode(input: Uint8Array, options: BackendDecodeOptions): BackendDecodeResult;
  encode(input: string, encoding: RelicMEMEncodingName, options?: EncodeOptions): EncodeResult;
}
