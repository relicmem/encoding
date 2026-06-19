import { describe, expect, it } from "vitest";

import { EncodingError, createEncodingWarning } from "../src/index.js";
import type {
  EncodingCandidate,
  EncodingDetectionResult,
  EncodingWarning,
  NormalizedEncodingLabel,
  OffsetMapSegment,
} from "../src/index.js";
import { createDecodedDocument } from "../src/source/DecodedDocument.js";
import { createOffsetMap } from "../src/source/OffsetMap.js";
import { createSourceBuffer } from "../src/source/SourceBuffer.js";

describe("DecodedDocument assembly", () => {
  it("freezes document layers and protects exposed arrays from caller mutation", () => {
    const source = createSourceBuffer(new Uint8Array([0x41]));
    const candidate = createCandidate("Original candidate.");
    const label = createLabel(["utf8"]);
    const detectionWarning = createMutableWarning("ENCODING_LOW_CONFIDENCE", {
      byteRange: { start: 0, end: 1 },
      details: {
        stage: "detection",
      },
    });
    const backendWarning = createMutableWarning("ENCODING_BACKEND_SUBSTITUTION", {
      details: {
        backend: "native",
      },
    });
    const segment = createSegment(0, 1, 0, 1);
    const detection = createDetection({
      candidates: [candidate],
      label,
      warnings: [detectionWarning],
    });
    const document = createDecodedDocument({
      text: "A",
      source,
      detection,
      backend: {
        name: "native",
        version: "native-v1",
        exactSourceMap: true,
      },
      offsetMap: createOffsetMap([segment]),
      warnings: {
        backend: [backendWarning],
      },
    });

    (candidate as { reason: string }).reason = "Mutated candidate.";
    (label.aliases as string[]).push("mutated");
    mutateWarningRange(detectionWarning, 99);
    mutateWarningDetails(backendWarning, "backend", "mutated");
    (segment.byteRange as { end: number }).end = 99;
    const bytes = document.bytes;
    bytes[0] = 0x00;

    expect(Object.isFrozen(document)).toBe(true);
    expect(Object.isFrozen(document.detection.candidates)).toBe(true);
    expect(Object.isFrozen(document.detection.label.aliases)).toBe(true);
    expect(Object.isFrozen(document.warnings)).toBe(true);
    expect([...document.bytes]).toEqual([0x41]);
    expect(document.detection).toMatchObject({
      backend: {
        name: "native",
        version: "native-v1",
        exactSourceMap: true,
      },
      candidates: [
        {
          reason: "Original candidate.",
        },
      ],
      label: {
        aliases: ["utf8"],
      },
    });
    expect(document.warnings).toEqual([
      {
        code: "ENCODING_LOW_CONFIDENCE",
        severity: "warning",
        message: "ENCODING_LOW_CONFIDENCE warning.",
        byteRange: { start: 0, end: 1 },
        details: {
          stage: "detection",
        },
      },
      {
        code: "ENCODING_BACKEND_SUBSTITUTION",
        severity: "warning",
        message: "ENCODING_BACKEND_SUBSTITUTION warning.",
        details: {
          backend: "native",
        },
      },
    ]);
    expect(document.offsetMap.segments()).toEqual([createSegment(0, 1, 0, 1)]);
    expect(document.lineIndex.lineByteRange(1)).toEqual({ start: 0, end: 1 });
  });

  it("keeps warning groups in document order and drops only exact duplicate warnings", () => {
    const duplicate = createWarning("ENCODING_LOW_CONFIDENCE", {
      byteRange: { start: 0, end: 1 },
      details: {
        source: "duplicate",
      },
    });
    const sameCodeDifferentRange = createWarning("ENCODING_LOW_CONFIDENCE", {
      byteRange: { start: 1, end: 2 },
      details: {
        source: "different-range",
      },
    });
    const sourceMapWarning = createWarning("ENCODING_INVALID_SEQUENCE_REPLACED", {
      byteRange: { start: 2, end: 3 },
      textRange: { start: 2, end: 3 },
    });
    const streamWarning = createWarning("ENCODING_INCOMPLETE_STREAM_SEQUENCE", {
      byteRange: { start: 3, end: 4 },
    });
    const document = createDecodedDocument({
      text: "ABCD",
      source: createSourceBuffer(new Uint8Array([0x41, 0x42, 0x43, 0x44])),
      detection: createDetection({
        warnings: [duplicate],
      }),
      offsetMap: createOffsetMap([createSegment(0, 4, 0, 4)]),
      warnings: {
        backend: [duplicate, sameCodeDifferentRange],
        sourceMap: [sourceMapWarning],
        streamFinalization: [streamWarning],
      },
    });

    expect(document.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_LOW_CONFIDENCE",
      "ENCODING_LOW_CONFIDENCE",
      "ENCODING_INVALID_SEQUENCE_REPLACED",
      "ENCODING_INCOMPLETE_STREAM_SEQUENCE",
    ]);
    expect(document.warnings.map((warning) => warning.byteRange)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ]);
  });

  it("rejects a successful document when the source map does not cover bytes and text", () => {
    expect(() =>
      createDecodedDocument({
        text: "AB",
        source: createSourceBuffer(new Uint8Array([0x41, 0x42])),
        detection: createDetection(),
        offsetMap: createOffsetMap([createSegment(0, 1, 0, 1)]),
      }),
    ).toThrow(EncodingError);

    try {
      createDecodedDocument({
        text: "AB",
        source: createSourceBuffer(new Uint8Array([0x41, 0x42])),
        detection: createDetection(),
        offsetMap: createOffsetMap([createSegment(0, 1, 0, 1)]),
      });
      throw new Error("Expected DecodedDocument source map invariant failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
      expect((error as EncodingError).details).toMatchObject({
        byteLength: 2,
        textLength: 2,
        mappedByteLength: 1,
        mappedTextLength: 1,
      });
    }
  });
});

function createDetection(
  options: {
    readonly candidates?: readonly EncodingCandidate[];
    readonly label?: NormalizedEncodingLabel;
    readonly warnings?: readonly EncodingWarning[];
  } = {},
): EncodingDetectionResult {
  return {
    encoding: "utf-8",
    confidence: 1,
    source: "utf8-validation",
    bomLength: 0,
    candidates: options.candidates ?? [createCandidate("Valid UTF-8.")],
    warnings: options.warnings ?? [],
    label: options.label ?? createLabel(["utf8"]),
    backend: {
      name: "native",
      exactSourceMap: false,
    },
  };
}

function createCandidate(reason: string): EncodingCandidate {
  return {
    encoding: "utf-8",
    confidence: 1,
    source: "utf8-validation",
    reason,
    bomLength: 0,
  };
}

function createLabel(aliases: string[]): NormalizedEncodingLabel {
  return {
    inputLabel: "utf-8",
    canonical: "utf-8",
    aliases,
    source: "profile",
  };
}

function createWarning(
  code: EncodingWarning["code"],
  options: Pick<EncodingWarning, "byteRange" | "textRange" | "details"> = {},
): EncodingWarning {
  return createEncodingWarning({
    code,
    message: `${code} warning.`,
    ...optionalProperty("byteRange", options.byteRange),
    ...optionalProperty("textRange", options.textRange),
    ...optionalProperty("details", options.details),
  });
}

function createMutableWarning(
  code: EncodingWarning["code"],
  options: Pick<EncodingWarning, "byteRange" | "textRange" | "details"> = {},
): EncodingWarning {
  return {
    code,
    severity: "warning",
    message: `${code} warning.`,
    ...optionalProperty("byteRange", options.byteRange),
    ...optionalProperty("textRange", options.textRange),
    ...optionalProperty("details", options.details),
  };
}

function createSegment(
  byteStart: number,
  byteEnd: number,
  textStart: number,
  textEnd: number,
): OffsetMapSegment {
  return {
    byteRange: { start: byteStart, end: byteEnd },
    textRange: { start: textStart, end: textEnd },
    kind: byteEnd - byteStart === textEnd - textStart ? "identity" : "encoded",
  };
}

function mutateWarningRange(warning: EncodingWarning, start: number): void {
  if (warning.byteRange === undefined) {
    return;
  }

  (warning.byteRange as { start: number }).start = start;
}

function mutateWarningDetails(warning: EncodingWarning, key: string, value: unknown): void {
  if (warning.details === undefined) {
    return;
  }

  (warning.details as Record<string, unknown>)[key] = value;
}

function optionalProperty<TKey extends string, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<TKey, TValue>>);
}
