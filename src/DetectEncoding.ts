import type { EncodingDetectionResult } from "./contracts/detection.js";
import type { DetectEncodingOptions } from "./contracts/encoding.js";
import { detectCompositeEncoding } from "./detector/CompositeDetector.js";

export function detectEncoding(
  input: Uint8Array,
  options?: DetectEncodingOptions,
): EncodingDetectionResult {
  return detectCompositeEncoding(input, options);
}
