import type { DecoderBackendInfo } from "./contracts/backend.js";
import {
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
  isEncodingError,
} from "./contracts/diagnostics.js";
import type { EncodingResult } from "./contracts/diagnostics.js";
import type { EncodedText, EncodeTextOptions, RelicMEMEncodingName } from "./contracts/encoding.js";
import type { NormalizedEncodingLabel } from "./contracts/detection.js";
import { selectDefaultEncoderBackend } from "./decoder/index.js";
import { normalizeEncodingLabel } from "./encoding/EncodingRegistry.js";

export function encodeText(
  input: string,
  encoding: string,
  options?: EncodeTextOptions,
): EncodedText {
  const label = normalizeEncodingLabel(encoding, {
    source: "explicit",
  });
  const selection = selectDefaultEncoderBackend(label.canonical);
  const result = selection.backend.encode(input, label.canonical, options);

  return freezeEncodedText({
    bytes: result.bytes,
    warnings: result.warnings,
    encoding: label.canonical,
    label,
    backend: selection.info,
  });
}

export function tryEncodeText(
  input: string,
  encoding: string,
  options?: EncodeTextOptions,
): EncodingResult<EncodedText> {
  try {
    return encodingSuccess(encodeText(input, encoding, options));
  } catch (error) {
    if (isEncodingError(error)) {
      return encodingFailure(error);
    }

    throw error;
  }
}

export function canEncodeText(
  input: string,
  encoding: string,
  options?: EncodeTextOptions,
): boolean {
  return tryEncodeText(input, encoding, options).ok;
}

function freezeEncodedText(options: {
  readonly bytes: Uint8Array;
  readonly warnings: EncodedText["warnings"];
  readonly encoding: RelicMEMEncodingName;
  readonly label: NormalizedEncodingLabel;
  readonly backend: DecoderBackendInfo;
}): EncodedText {
  return Object.freeze({
    bytes: new Uint8Array(options.bytes),
    warnings: freezeEncodingWarnings(options.warnings),
    encoding: options.encoding,
    label: options.label,
    backend: options.backend,
  });
}
