export { createLineIndex } from "./LineIndex.js";
export { normalizeEncodingInput, normalizeEncodingInputSync } from "./InputNormalization.js";
export type {
  NormalizedByteInput,
  NormalizedByteInputKind,
  NormalizedEncodingInput,
  NormalizedInputChunk,
  NormalizedInputKind,
  NormalizedInputSample,
  NormalizedInputSourceKind,
  NormalizedStringInput,
} from "./InputNormalization.js";
export {
  buildExactOffsetMap,
  buildIdentityOffsetMap,
  buildSingleByteOffsetMap,
  buildSyntheticUtf8StringOffsetMap,
  buildUtf16BeOffsetMap,
  buildUtf16LeOffsetMap,
  buildUtf16OffsetMap,
  buildUtf8OffsetMap,
} from "./OffsetMapBuilder.js";
export type {
  ExactOffsetMapBuilderOptions,
  OffsetMapBuilderOptions,
  OffsetMapBuildResult,
  SingleByteOffsetMapBuilderOptions,
  SyntheticUtf8StringOffsetMapBuildResult,
  Utf16ByteOrder,
  Utf16OffsetMapBuilderOptions,
} from "./OffsetMapBuilder.js";
export { createOffsetMap } from "./OffsetMap.js";
export { createDecodedStringDocument } from "./StringInput.js";
export type { DecodedStringInputOptions } from "./StringInput.js";
export { createSourceBuffer, createSourceBufferFromChunks } from "./SourceBuffer.js";
export type { SourceBufferInput } from "./SourceBuffer.js";
export {
  assertOffsetBias,
  isCollapsedRange,
  normalizeOffsetBias,
  normalizeSourceByteRange,
  normalizeTextRange,
  rangeLength,
  resolveOffsetByBias,
  validateSourceByteRange,
  validateTextRange,
} from "./ranges.js";
export type { OffsetProjectionOptions } from "./ranges.js";
