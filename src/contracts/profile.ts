import type { RelicMEMEncodingName } from "./encoding.js";

export interface EncodingProfile {
  readonly name: string;
  readonly allowedEncodings: readonly RelicMEMEncodingName[];
  readonly asciiCompatibleEncodings: readonly RelicMEMEncodingName[];
  readonly nativeByteSafeEncodings: readonly RelicMEMEncodingName[];
  readonly defaultEncoding: RelicMEMEncodingName;
  readonly minConfidence: number;
  readonly legacyHeuristics: boolean;
  readonly utf16Heuristics: boolean;
  readonly metadataSniffing: boolean;
}
