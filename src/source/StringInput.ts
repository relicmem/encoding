import type { DecoderBackendInfo } from "../contracts/backend.js";
import type {
  EncodingCandidate,
  EncodingDetectionResult,
  NormalizedEncodingLabel,
} from "../contracts/detection.js";
import {
  createEncodingWarning,
  freezeEncodingWarnings,
  mergeEncodingWarnings,
} from "../contracts/diagnostics.js";
import type { EncodingWarning } from "../contracts/diagnostics.js";
import type { DecodedDocument } from "../contracts/document.js";
import type {
  RmemEncodingName,
  RmemEncodingProfileName,
  SourceMapMode,
} from "../contracts/encoding.js";
import type { EncodingProfile } from "../contracts/profile.js";
import { createEncodingCandidate } from "../detector/ConfidencePolicy.js";
import { normalizeEncodingLabel } from "../encoding/EncodingRegistry.js";
import { createLineIndex } from "./LineIndex.js";
import { buildSyntheticUtf8StringOffsetMap } from "./OffsetMapBuilder.js";
import { createSourceBuffer } from "./SourceBuffer.js";

export interface DecodedStringInputOptions {
  readonly profile?: RmemEncodingProfileName | EncodingProfile;
  readonly explicitEncoding?: string;
  readonly defaultEncoding?: RmemEncodingName;
  readonly sourceMap?: SourceMapMode;
}

interface StringInputEncodingDecision {
  readonly label: NormalizedEncodingLabel;
}

const NATIVE_STRING_BACKEND_INFO: DecoderBackendInfo = Object.freeze({
  name: "native",
  exactSourceMap: true,
});

export function createDecodedStringDocument(
  input: string,
  options?: DecodedStringInputOptions,
): DecodedDocument {
  assertStringInput(input);

  const normalizedOptions = normalizeDecodedStringInputOptions(options);
  const encodingDecision = resolveStringInputEncoding(normalizedOptions);
  const offsetMapBuild = buildSyntheticUtf8StringOffsetMap(input);
  const source = createSourceBuffer(offsetMapBuild.bytes);
  const sourceMapWarnings = createSyntheticSourceMapWarnings(
    input,
    offsetMapBuild.bytes,
    encodingDecision.label.canonical,
    normalizedOptions,
  );
  const detection = createStringInputDetection(encodingDecision);
  const warnings = mergeEncodingWarnings(offsetMapBuild.warnings, sourceMapWarnings);

  return createDecodedDocument({
    text: input,
    detection,
    lineIndex: createLineIndex(input, offsetMapBuild.offsetMap),
    offsetMap: offsetMapBuild.offsetMap,
    warnings,
    source,
  });
}

function normalizeDecodedStringInputOptions(options: unknown): DecodedStringInputOptions {
  if (options === undefined) {
    return {};
  }

  if (typeof options !== "object" || options === null) {
    throw new TypeError("String input options must be an object.");
  }

  const decodedStringInputOptions = options as DecodedStringInputOptions;
  assertSourceMapMode(decodedStringInputOptions.sourceMap);

  return decodedStringInputOptions;
}

function resolveStringInputEncoding(
  options: DecodedStringInputOptions,
): StringInputEncodingDecision {
  if (options.explicitEncoding !== undefined) {
    if (typeof options.explicitEncoding !== "string") {
      throw new TypeError("explicitEncoding must be a string.");
    }

    return {
      label: normalizeEncodingLabel(options.explicitEncoding, {
        source: "explicit",
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      }),
    };
  }

  if (options.defaultEncoding !== undefined && typeof options.defaultEncoding !== "string") {
    throw new TypeError("defaultEncoding must be a string.");
  }

  return {
    label: normalizeEncodingLabel(options.defaultEncoding ?? "utf-8", {
      source: "default",
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    }),
  };
}

function createSyntheticSourceMapWarnings(
  text: string,
  bytes: Uint8Array,
  encoding: RmemEncodingName,
  options: DecodedStringInputOptions,
): readonly EncodingWarning[] {
  if (options.sourceMap !== "exact") {
    return freezeEncodingWarnings([]);
  }

  return freezeEncodingWarnings([
    createEncodingWarning({
      code: "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
      message:
        "String input uses synthetic UTF-8 bytes; source ranges do not reference original bytes.",
      byteRange: { start: 0, end: bytes.byteLength },
      textRange: { start: 0, end: text.length },
      details: {
        declaredEncoding: encoding,
        syntheticEncoding: "utf-8",
        sourceMap: "exact",
      },
    }),
  ]);
}

function createStringInputDetection(
  encodingDecision: StringInputEncodingDecision,
): EncodingDetectionResult {
  const candidate = createStringInputCandidate(encodingDecision);

  return Object.freeze({
    encoding: encodingDecision.label.canonical,
    confidence: 1,
    source: "explicit",
    bomLength: 0,
    candidates: Object.freeze([candidate]),
    warnings: freezeEncodingWarnings([]),
    label: encodingDecision.label,
    backend: NATIVE_STRING_BACKEND_INFO,
  });
}

function createStringInputCandidate(
  encodingDecision: StringInputEncodingDecision,
): EncodingCandidate {
  return createEncodingCandidate({
    encoding: encodingDecision.label.canonical,
    confidence: 1,
    source: "explicit",
    reason:
      encodingDecision.label.source === "explicit"
        ? "Already-decoded string input used the explicit encoding label without detection heuristics."
        : "Already-decoded string input used the default encoding label without detection heuristics.",
    bomLength: 0,
  });
}

function createDecodedDocument(parts: Omit<DecodedDocument, "bytes">): DecodedDocument {
  return Object.freeze({
    text: parts.text,
    get bytes(): Uint8Array {
      return parts.source.bytes;
    },
    detection: parts.detection,
    lineIndex: parts.lineIndex,
    offsetMap: parts.offsetMap,
    warnings: parts.warnings,
    source: parts.source,
  });
}

function assertStringInput(input: string): void {
  if (typeof input !== "string") {
    throw new TypeError("Decoded string input must be a string.");
  }
}

function assertSourceMapMode(sourceMap: unknown): asserts sourceMap is SourceMapMode | undefined {
  if (
    sourceMap !== undefined &&
    sourceMap !== "exact" &&
    sourceMap !== "line" &&
    sourceMap !== "none"
  ) {
    throw new RangeError("sourceMap must be one of: exact, line, none.");
  }
}
