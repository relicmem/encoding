import type { DecodedDocument } from "./contracts/document.js";
import type { DecodeDocumentOptions, EncodingInput } from "./contracts/encoding.js";
import { encodingFailure, encodingSuccess, isEncodingError } from "./contracts/diagnostics.js";
import type { EncodingResult } from "./contracts/diagnostics.js";
import { decodeNormalizedDocument } from "./DecodeDocumentCore.js";
import { normalizeDecodeDocumentOptions } from "./encoding/OptionsNormalization.js";
import { normalizeEncodingInput } from "./source/index.js";

export async function tryDecodeDocument(
  input: EncodingInput,
  options?: DecodeDocumentOptions,
): Promise<EncodingResult<DecodedDocument>> {
  const normalizedOptions = normalizeOptionsAsResult(options);
  if (!normalizedOptions.ok) {
    return normalizedOptions;
  }

  const normalizedInput = await normalizeEncodingInput(input);

  try {
    return encodingSuccess(decodeNormalizedDocument(normalizedInput, normalizedOptions.value));
  } catch (error) {
    return encodingFailureOrRethrow(error);
  }
}

function normalizeOptionsAsResult(
  options: DecodeDocumentOptions | undefined,
): EncodingResult<ReturnType<typeof normalizeDecodeDocumentOptions>> {
  try {
    return encodingSuccess(normalizeDecodeDocumentOptions(options));
  } catch (error) {
    return encodingFailureOrRethrow(error);
  }
}

function encodingFailureOrRethrow(error: unknown): never | ReturnType<typeof encodingFailure> {
  if (isEncodingError(error)) {
    return encodingFailure(error);
  }

  throw error;
}
