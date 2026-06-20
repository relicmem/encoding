import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import type { EncodingProfile } from "../src/index.js";
import {
  detectCompositeEncoding,
  tryDetectCompositeEncoding,
} from "../src/detector/CompositeDetector.js";
import { LEGACY_CYRILLIC_PROFILE } from "../src/profile/EncodingProfiles.js";

const UTF8_FALLBACK_ONLY_PROFILE: EncodingProfile = {
  name: "utf8FallbackOnly",
  allowedEncodings: ["utf-8"],
  asciiCompatibleEncodings: ["utf-8"],
  nativeByteSafeEncodings: ["utf-8"],
  defaultEncoding: "utf-8",
  minConfidence: 0.75,
  legacyHeuristics: false,
  utf16Heuristics: false,
  metadataSniffing: false,
};

const WINDOWS_1251_CYRILLIC_BYTES = new Uint8Array([
  0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2e, 0x20, 0xc4, 0xee, 0xea, 0xf3,
  0xec, 0xe5, 0xed, 0xf2, 0xfb, 0x20, 0xf5, 0xf0, 0xe0, 0xed, 0xff, 0xf2, 0x20, 0xe7, 0xed, 0xe0,
  0xed, 0xe8, 0xff, 0x2e, 0x0a,
]);

describe("composite detection pipeline", () => {
  it("keeps explicit encoding above BOM while surfacing the BOM conflict", () => {
    const result = detectCompositeEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), {
      explicitEncoding: "windows-1251",
    });

    expect(result).toMatchObject({
      encoding: "windows-1251",
      confidence: 1,
      source: "explicit",
      bomLength: 3,
      label: {
        inputLabel: "windows-1251",
        canonical: "windows-1251",
        source: "explicit",
      },
      backend: {
        name: "native",
        exactSourceMap: false,
      },
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "explicit",
      "bom",
      "fallback",
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["ENCODING_BOM_CONFLICT"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it("lets BOM override metadata and keeps the metadata conflict warning", () => {
    const result = detectCompositeEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]), {
      profile: "webCompat",
      metadata: {
        declaredEncoding: "windows-1251",
        sourceName: "web.md",
      },
    });

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 1,
      source: "bom",
      bomLength: 3,
      label: {
        inputLabel: "utf-8",
        canonical: "utf-8",
        source: "bom",
      },
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual(["bom", "fallback"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_BOM_CONFLICT",
      message: "Metadata encoding conflicts with BOM and was ignored.",
      details: {
        higherPrioritySource: "bom",
        higherPriorityEncoding: "utf-8",
        sourceName: "web.md",
      },
    });
  });

  it("applies metadata before byte-level UTF-8 validation for web-compatible input", () => {
    const result = detectCompositeEncoding(new TextEncoder().encode("Cafe"), {
      profile: "webCompat",
      metadata: {
        declaredEncoding: "latin1",
      },
    });

    expect(result).toMatchObject({
      encoding: "windows-1252",
      confidence: 0.95,
      source: "metadata",
      bomLength: 0,
      label: {
        inputLabel: "latin1",
        canonical: "windows-1252",
        source: "metadata",
      },
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "metadata",
      "utf8-validation",
      "fallback",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("selects valid UTF-8 before legacy heuristics in the default relicmem profile", () => {
    const result = detectCompositeEncoding(new TextEncoder().encode("Привіт, документе."));

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
      bomLength: 0,
      label: {
        inputLabel: "utf-8",
        canonical: "utf-8",
        source: "profile",
      },
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "utf8-validation",
      "fallback",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("uses legacy heuristics after invalid UTF-8 when the active profile allows them", () => {
    const result = detectCompositeEncoding(WINDOWS_1251_CYRILLIC_BYTES, {
      profile: LEGACY_CYRILLIC_PROFILE,
    });

    expect(result).toMatchObject({
      encoding: "windows-1251",
      source: "heuristic",
      bomLength: 0,
      label: {
        inputLabel: "windows-1251",
        canonical: "windows-1251",
        source: "profile",
      },
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.candidates[0]).toMatchObject({
      encoding: "windows-1251",
      source: "heuristic",
    });
    expect(result.candidates.at(-1)).toMatchObject({
      encoding: "windows-1251",
      source: "fallback",
    });
  });

  it("falls back to the default encoding with explicit fallback and confidence warnings", () => {
    const result = detectCompositeEncoding(new Uint8Array([0xff]), {
      profile: UTF8_FALLBACK_ONLY_PROFILE,
    });

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 0,
      source: "fallback",
      bomLength: 0,
      label: {
        inputLabel: "utf-8",
        canonical: "utf-8",
        source: "profile",
      },
    });
    expect(result.candidates).toEqual([
      {
        encoding: "utf-8",
        confidence: 0,
        source: "fallback",
        reason: "Default encoding fallback was used because detection found no stronger signal.",
        bomLength: 0,
      },
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_FALLBACK_USED",
      "ENCODING_LOW_CONFIDENCE",
    ]);
  });

  it("treats invalid UTF-8 as fatal for the strictUtf8 profile", () => {
    expect(() =>
      detectCompositeEncoding(new Uint8Array([0xc3, 0x28]), {
        profile: "strictUtf8",
      }),
    ).toThrow(EncodingError);

    const result = tryDetectCompositeEncoding(new Uint8Array([0xc3, 0x28]), {
      profile: "strictUtf8",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "ENCODING_INVALID_SEQUENCE",
        message: "Invalid UTF-8 continuation byte.",
        byteRange: {
          start: 0,
          end: 1,
        },
        details: {
          encoding: "utf-8",
        },
      });
    }
  });
});
