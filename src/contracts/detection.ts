import type { DecoderBackendInfo } from "./backend.js";
import type { RelicMEMEncodingName } from "./encoding.js";
import type { EncodingWarning } from "./diagnostics.js";

export type EncodingDetectionSource =
  | "explicit"
  | "bom"
  | "utf8-validation"
  | "utf16-heuristic"
  | "metadata"
  | "heuristic"
  | "fallback";

export type NormalizedEncodingLabelSource = "explicit" | "metadata" | "bom" | "profile" | "default";

export interface EncodingCandidate {
  readonly encoding: RelicMEMEncodingName;
  readonly confidence: number;
  readonly source: EncodingDetectionSource;
  readonly reason: string;
  readonly bomLength: number;
}

export interface NormalizedEncodingLabel {
  readonly inputLabel?: string;
  readonly canonical: RelicMEMEncodingName;
  readonly aliases: readonly string[];
  readonly source: NormalizedEncodingLabelSource;
}

export interface EncodingDetectionResult {
  readonly encoding: RelicMEMEncodingName;
  readonly confidence: number;
  readonly source: EncodingDetectionSource;
  readonly bomLength: number;
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly label: NormalizedEncodingLabel;
  readonly backend: DecoderBackendInfo;
}
