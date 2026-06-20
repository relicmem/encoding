import { describe, expect, it } from "vitest";

import { EncodingError, normalizeEncodingLabel } from "../src/index.js";
import { detectUtf16, tryDetectUtf16 } from "../src/detector/Utf16Detector.js";
import { RELICMEM_PROFILE, STRICT_UTF8_PROFILE } from "../src/profile/EncodingProfiles.js";

describe("UTF-16 detector", () => {
  it.each([
    {
      encoding: "utf-16le",
      bytes: [0xff, 0xfe, 0x41],
      bomLength: 2,
      reason: "UTF-16LE byte order mark.",
    },
    {
      encoding: "utf-16be",
      bytes: [0xfe, 0xff, 0x00],
      bomLength: 2,
      reason: "UTF-16BE byte order mark.",
    },
  ] as const)(
    "recognizes $encoding BOM before heuristic checks",
    ({ encoding, bytes, bomLength, reason }) => {
      const result = detectUtf16(new Uint8Array(bytes));

      expect(result.bom).toMatchObject({
        encoding,
        bomLength,
        byteRange: {
          start: 0,
          end: bomLength,
        },
      });
      expect(result.candidates).toEqual([
        {
          encoding,
          confidence: 1,
          source: "bom",
          reason,
          bomLength,
        },
      ]);
      expect(result.heuristic).toBeUndefined();
      expect(result.ignoredReason).toBe("bom");
      expect(result.warnings).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.candidates)).toBe(true);
    },
  );

  it("creates a UTF-16LE heuristic candidate from NUL distribution and printable ratio", () => {
    const result = detectUtf16(
      new Uint8Array([
        0x23, 0x00, 0x20, 0x00, 0x54, 0x00, 0x69, 0x00, 0x74, 0x00, 0x6c, 0x00, 0x65, 0x00, 0x0a,
        0x00,
      ]),
    );

    expect(result.bom).toBeUndefined();
    expect(result.ignoredReason).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      encoding: "utf-16le",
      confidence: 1,
      source: "utf16-heuristic",
      bomLength: 0,
    });
    expect(result.heuristic).toMatchObject({
      byteLength: 16,
      codeUnitCount: 8,
      evenByteNullRatio: 0,
      oddByteNullRatio: 1,
      oddByteLength: false,
      likelyUtf32: false,
    });
    expect(result.heuristic?.scores.find((score) => score.encoding === "utf-16le")).toMatchObject({
      highByteNullRatio: 1,
      lowByteNullRatio: 0,
      printableRatio: 1,
      controlRatio: 0,
    });
    expect(result.warnings).toEqual([]);
  });

  it("creates a UTF-16BE heuristic candidate from the opposite byte lane", () => {
    const result = detectUtf16(
      new Uint8Array([
        0x00, 0x23, 0x00, 0x20, 0x00, 0x54, 0x00, 0x69, 0x00, 0x74, 0x00, 0x6c, 0x00, 0x65, 0x00,
        0x0a,
      ]),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      encoding: "utf-16be",
      confidence: 1,
      source: "utf16-heuristic",
    });
    expect(result.heuristic).toMatchObject({
      evenByteNullRatio: 1,
      oddByteNullRatio: 0,
    });
  });

  it("respects profile utf16Heuristics and does not infer UTF-16 for strictUtf8", () => {
    const result = detectUtf16(new Uint8Array([0x23, 0x00, 0x20, 0x00, 0x41, 0x00, 0x0a, 0x00]), {
      profile: STRICT_UTF8_PROFILE,
    });

    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toBeUndefined();
    expect(result.ignoredReason).toBe("heuristics-disabled");
    expect(result.warnings).toEqual([]);
  });

  it("does not let UTF-16 heuristic override explicit encoding", () => {
    const explicitEncoding = normalizeEncodingLabel("utf-8", {
      source: "explicit",
      profile: RELICMEM_PROFILE,
    });
    const result = detectUtf16(new Uint8Array([0x23, 0x00, 0x20, 0x00, 0x41, 0x00, 0x0a, 0x00]), {
      explicitEncoding,
    });

    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toBeUndefined();
    expect(result.ignoredReason).toBe("explicit-encoding");
  });

  it("does not let UTF-16 heuristic override a non-UTF-16 BOM", () => {
    const result = detectUtf16(
      new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x00, 0x20, 0x00, 0x41, 0x00, 0x0a, 0x00]),
    );

    expect(result.bom?.encoding).toBe("utf-8");
    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toBeUndefined();
    expect(result.ignoredReason).toBe("bom");
  });

  it("reports weak or structurally invalid UTF-16 signals without creating candidates", () => {
    const odd = detectUtf16(new Uint8Array([0x23, 0x00, 0x20, 0x00, 0x41]));

    expect(odd.candidates).toEqual([]);
    expect(odd.ignoredReason).toBe("odd-byte-length");
    expect(odd.warnings[0]).toMatchObject({
      code: "ENCODING_LOW_CONFIDENCE",
      message: "UTF-16 heuristic was skipped because byte length is odd.",
      byteRange: {
        start: 4,
        end: 5,
      },
    });

    const weak = detectUtf16(new Uint8Array([0x23, 0x00, 0x20, 0x01, 0x41, 0x00, 0x42, 0x01]));

    expect(weak.candidates).toEqual([]);
    expect(weak.ignoredReason).toBe("weak-signal");
    expect(weak.warnings.map((warning) => warning.code)).toEqual(["ENCODING_LOW_CONFIDENCE"]);
  });

  it("ignores likely UTF-32 instead of misclassifying it as UTF-16", () => {
    const result = detectUtf16(
      new Uint8Array([
        0x23, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00,
        0x00,
      ]),
    );

    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toMatchObject({
      likelyUtf32: true,
    });
    expect(result.ignoredReason).toBe("unsupported-utf32");
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      message: "Input looks like UTF-32, which is not supported by this detector.",
    });
  });

  it("turns disallowed UTF-16 BOM into structured failure through tryDetectUtf16", () => {
    expect(() =>
      detectUtf16(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
        profile: STRICT_UTF8_PROFILE,
      }),
    ).toThrow(EncodingError);

    const result = tryDetectUtf16(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
      profile: STRICT_UTF8_PROFILE,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        details: {
          encoding: "utf-16le",
          bomLength: 2,
          allowedEncodings: ["utf-8"],
        },
      });
    }
  });
});
