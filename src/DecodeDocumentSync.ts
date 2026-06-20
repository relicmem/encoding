import type { DecodeDocumentOptions, SyncEncodingInput } from "./contracts/encoding.js";
import type { DecodedDocument } from "./contracts/document.js";
import { decodeNormalizedDocument } from "./DecodeDocumentCore.js";
import { normalizeDecodeDocumentOptions } from "./encoding/OptionsNormalization.js";
import { normalizeEncodingInputSync } from "./source/index.js";

export function decodeDocumentSync(
  input: SyncEncodingInput,
  options?: DecodeDocumentOptions,
): DecodedDocument {
  const normalizedOptions = normalizeDecodeDocumentOptions(options);
  const normalizedInput = normalizeEncodingInputSync(input);

  return decodeNormalizedDocument(normalizedInput, normalizedOptions);
}
