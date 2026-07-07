import type { DecoderBackend, DecoderBackendInfo } from "./contracts/backend.js";
import {
  createEncodingError,
  encodingFailure,
  encodingSuccess,
  freezeEncodingWarnings,
  isEncodingError,
} from "./contracts/diagnostics.js";
import type { EncodingResult } from "./contracts/diagnostics.js";
import type { EncodedText, EncodeTextOptions, RelicMEMEncodingName } from "./contracts/encoding.js";
import type { NormalizedEncodingLabel } from "./contracts/detection.js";
import { DEFAULT_DECODER_REGISTRY } from "./DecodeDocumentCore.js";
import { normalizeEncodingLabel } from "./encoding/EncodingRegistry.js";

interface EncoderBackendSelection {
  readonly backend: DecoderBackend;
  readonly info: DecoderBackendInfo;
}

export function encodeText(
  input: string,
  encoding: string,
  options?: EncodeTextOptions,
): EncodedText {
  const label = normalizeEncodingLabel(encoding, {
    source: "explicit",
  });
  const selection = selectTextEncoderBackend(label.canonical);
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

function selectTextEncoderBackend(encoding: RelicMEMEncodingName): EncoderBackendSelection {
  const backend = DEFAULT_DECODER_REGISTRY.getBackend("native");
  const info = DEFAULT_DECODER_REGISTRY.getBackendInfo("native");

  if (backend !== undefined && info !== undefined && backend.canEncode(encoding)) {
    return Object.freeze({
      backend,
      info,
    });
  }

  throw createEncodingError({
    code: "ENCODING_UNSUPPORTED_ENCODING",
    message: "No registered decoder backend can encode the requested encoding.",
    details: {
      encoding,
      requestedBackend: "native",
    },
  });
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
