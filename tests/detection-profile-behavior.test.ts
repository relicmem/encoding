import { describe, expect, it } from "vitest";

import { EncodingError, detectEncoding } from "../src/index.js";
import type { EncodingDetectionResult, RelicMEMEncodingName } from "../src/index.js";
import { loadFixture } from "./support/fixtures.js";

const encoder = new TextEncoder();

const LEGACY_CYRILLIC_FIXTURES = Object.freeze([
  {
    id: "windows1251-uk",
    encoding: "windows-1251",
  },
  {
    id: "koi8r-cyrillic",
    encoding: "koi8-r",
  },
  {
    id: "cp866-cyrillic",
    encoding: "cp866",
  },
  {
    id: "iso8859-5-cyrillic",
    encoding: "iso-8859-5",
  },
] as const satisfies readonly {
  readonly id: string;
  readonly encoding: RelicMEMEncodingName;
}[]);

describe("detection and profile behavior", () => {
  it("keeps explicit encoding above BOM and reports the conflict through the public API", () => {
    const result = detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), {
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
    });
    expect(candidatePairs(result)).toEqual([
      ["windows-1251", "explicit"],
      ["utf-8", "bom"],
      ["utf-8", "fallback"],
    ]);
    expect(warningCodes(result)).toEqual(["ENCODING_BOM_CONFLICT"]);
  });

  it("keeps BOM above metadata while preserving the ignored metadata warning", () => {
    const result = detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]), {
      profile: "webCompat",
      metadata: {
        declaredEncoding: "windows-1251",
        sourceName: "page.html",
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
    expect(candidatePairs(result)).toEqual([
      ["utf-8", "bom"],
      ["windows-1252", "fallback"],
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_BOM_CONFLICT",
      details: {
        higherPrioritySource: "bom",
        higherPriorityEncoding: "utf-8",
        sourceName: "page.html",
      },
    });
  });

  it("uses web-compatible metadata before UTF-8 validation and exposes WHATWG remapping", () => {
    const result = detectEncoding(encoder.encode("Cafe"), {
      profile: "webCompat",
      metadata: {
        contentType: "text/html; charset=latin1",
      },
    });

    expect(result).toMatchObject({
      encoding: "windows-1252",
      source: "metadata",
      label: {
        inputLabel: "latin1",
        canonical: "windows-1252",
        source: "metadata",
      },
    });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.label.aliases).toContain("iso-8859-1");
    expect(candidatePairs(result)).toEqual([
      ["windows-1252", "metadata"],
      ["utf-8", "utf8-validation"],
      ["windows-1252", "fallback"],
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("falls back with explicit fallback and confidence warnings when profiles leave no candidate", () => {
    const result = detectEncoding(new Uint8Array([0xff]), {
      profile: "legacyCyrillic",
      allowedEncodings: ["utf-8"],
      defaultEncoding: "utf-8",
    });

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 0,
      source: "fallback",
      bomLength: 0,
      label: {
        canonical: "utf-8",
        source: "default",
      },
    });
    expect(candidatePairs(result)).toEqual([["utf-8", "fallback"]]);
    expect(warningCodes(result)).toEqual(["ENCODING_FALLBACK_USED", "ENCODING_LOW_CONFIDENCE"]);
  });

  it("keeps strictUtf8 narrow: valid UTF-8 succeeds and invalid UTF-8 is fatal", () => {
    const validResult = detectEncoding(encoder.encode("Valid UTF-8"), {
      profile: "strictUtf8",
    });

    expect(validResult).toMatchObject({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
    });
    expect(candidatePairs(validResult)).toEqual([
      ["utf-8", "utf8-validation"],
      ["utf-8", "fallback"],
    ]);
    expect(validResult.warnings).toEqual([]);

    const error = captureEncodingError(() =>
      detectEncoding(new Uint8Array([0xc3, 0x28]), {
        profile: "strictUtf8",
      }),
    );

    expect(error).toMatchObject({
      code: "ENCODING_INVALID_SEQUENCE",
      message: "Invalid UTF-8 continuation byte.",
      details: {
        encoding: "utf-8",
      },
    });
  });

  it("does not let relicmem choose legacy encoding for valid UTF-8 Cyrillic text", () => {
    const result = detectEncoding(encoder.encode("Привіт, документе."), {
      profile: "relicmem",
    });

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
    });
    expect(candidatePairs(result)).toEqual([
      ["utf-8", "utf8-validation"],
      ["utf-8", "fallback"],
    ]);
    expect(result.candidates.some((candidate) => candidate.source === "heuristic")).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it.each(LEGACY_CYRILLIC_FIXTURES)(
    "selects $encoding for the $id legacyCyrillic fixture",
    async ({ id, encoding }) => {
      const fixture = await loadFixture(id);
      const result = detectEncoding(fixture.bytes, {
        profile: "legacyCyrillic",
      });

      expect(result).toMatchObject({
        encoding,
        source: "heuristic",
        bomLength: 0,
      });
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.candidates[0]).toMatchObject({
        encoding,
        source: "heuristic",
      });
      expect(warningCodes(result)).not.toContain("ENCODING_AMBIGUOUS_CANDIDATES");
    },
  );

  it("reports stable candidate order, confidence category and warnings for ambiguous legacy Cyrillic", () => {
    const result = detectEncoding(new Uint8Array([0xe0, 0xe0, 0xe0, 0xe0, 0xe0, 0xe0]), {
      profile: "legacyCyrillic",
      allowedEncodings: ["cp866", "iso-8859-5"],
      defaultEncoding: "cp866",
    });

    expect(result).toMatchObject({
      encoding: "iso-8859-5",
      confidence: 0.6,
      source: "heuristic",
    });
    expect(candidatePairs(result)).toEqual([
      ["iso-8859-5", "heuristic"],
      ["cp866", "heuristic"],
      ["cp866", "fallback"],
    ]);
    expect(warningCodes(result)).toContain("ENCODING_AMBIGUOUS_CANDIDATES");

    const ambiguousWarning = result.warnings.find(
      (warning) => warning.code === "ENCODING_AMBIGUOUS_CANDIDATES",
    );

    expect(ambiguousWarning).toMatchObject({
      details: {
        selected: {
          encoding: "iso-8859-5",
          confidence: 0.6,
          source: "heuristic",
        },
        candidates: [
          {
            encoding: "cp866",
            confidence: 0.6,
            source: "heuristic",
          },
        ],
      },
    });
  });

  it("rejects unsupported labels and option conflicts before selecting candidates", () => {
    const unsupportedLabel = captureEncodingError(() =>
      detectEncoding(new Uint8Array([0x41]), {
        explicitEncoding: "shift_jis",
      }),
    );

    expect(unsupportedLabel).toMatchObject({
      code: "ENCODING_UNSUPPORTED_LABEL",
      details: {
        label: "shift-jis",
        source: "explicit",
      },
    });

    const conflict = captureEncodingError(() =>
      detectEncoding(new Uint8Array([0x41]), {
        explicitEncoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      }),
    );

    expect(conflict).toMatchObject({
      code: "ENCODING_UNSUPPORTED_ENCODING",
      details: {
        option: "explicitEncoding",
        encoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      },
    });
  });
});

function candidatePairs(
  result: EncodingDetectionResult,
): readonly (readonly [RelicMEMEncodingName, string])[] {
  return result.candidates.map((candidate) => [candidate.encoding, candidate.source] as const);
}

function warningCodes(result: EncodingDetectionResult): readonly string[] {
  return result.warnings.map((warning) => warning.code);
}

function captureEncodingError(callback: () => unknown): EncodingError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(EncodingError);

    return error as EncodingError;
  }

  throw new Error("Expected EncodingError.");
}
