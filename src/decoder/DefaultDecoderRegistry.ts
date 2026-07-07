import { DECODER_BACKEND_NAMES } from "../contracts/backend.js";
import type { DecoderBackend, DecoderBackendName } from "../contracts/backend.js";
import type { RelicMEMEncodingName } from "../contracts/encoding.js";
import { createDecoderRegistry } from "./DecoderRegistry.js";
import type { EncoderBackendSelection } from "./DecoderRegistry.js";
import {
  createTextDecoderBackend,
  isTextDecoderBackendAvailable,
} from "./ExternalDecoderBackends.js";
import { NATIVE_UNICODE_BACKEND } from "./NativeUnicodeBackend.js";

export const DEFAULT_ENCODER_BACKEND_PREFERENCE = Object.freeze([
  ...DECODER_BACKEND_NAMES,
] as const satisfies readonly DecoderBackendName[]);

export const DEFAULT_DECODER_REGISTRY = createDecoderRegistry(createDefaultDecoderBackends());

export function selectDefaultEncoderBackend(
  encoding: RelicMEMEncodingName,
): EncoderBackendSelection {
  return DEFAULT_DECODER_REGISTRY.selectEncoderBackend({
    encoding,
    backendPreference: DEFAULT_ENCODER_BACKEND_PREFERENCE,
  });
}

function createDefaultDecoderBackends(): readonly DecoderBackend[] {
  const backends: DecoderBackend[] = [NATIVE_UNICODE_BACKEND];

  if (isTextDecoderBackendAvailable()) {
    backends.push(createTextDecoderBackend());
  }

  return Object.freeze(backends);
}
