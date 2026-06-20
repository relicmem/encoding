import type { DecodeDocumentOptions, EncodingInput } from "./contracts/encoding.js";
import type { DecodedDocument } from "./contracts/document.js";
import { decodeNormalizedDocument } from "./DecodeDocumentCore.js";
import { normalizeDecodeDocumentOptions } from "./encoding/OptionsNormalization.js";
import { normalizeEncodingInput } from "./source/index.js";

export async function decodeDocument(
  input: EncodingInput,
  options?: DecodeDocumentOptions,
): Promise<DecodedDocument> {
  const normalizedOptions = normalizeDecodeDocumentOptions(options);
  const normalizedInput = await normalizeEncodingInput(input);

  return decodeNormalizedDocument(normalizedInput, normalizedOptions);
}
