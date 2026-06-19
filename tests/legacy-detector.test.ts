import { describe, expect, it } from "vitest";

import { EncodingError, normalizeEncodingLabel } from "../src/index.js";
import type { RmemEncodingName } from "../src/index.js";
import { detectLegacyEncoding, tryDetectLegacyEncoding } from "../src/detector/LegacyDetector.js";
import {
  LEGACY_CYRILLIC_PROFILE,
  RMEM_PROFILE,
  STRICT_UTF8_PROFILE,
  WEB_COMPAT_PROFILE,
} from "../src/profile/EncodingProfiles.js";

const CYRILLIC_FIXTURES = Object.freeze([
  {
    encoding: "windows-1251",
    bytes: [
      0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2e, 0x20, 0xc4, 0xee, 0xea,
      0xf3, 0xec, 0xe5, 0xed, 0xf2, 0xfb, 0x20, 0xf5, 0xf0, 0xe0, 0xed, 0xff, 0xf2, 0x20, 0xe7,
      0xed, 0xe0, 0xed, 0xe8, 0xff, 0x2e, 0x0a,
    ],
  },
  {
    encoding: "koi8-r",
    bytes: [
      0xf0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4, 0x20, 0xcd, 0xc9, 0xd2, 0x2e, 0x20, 0xe4, 0xcf, 0xcb,
      0xd5, 0xcd, 0xc5, 0xce, 0xd4, 0xd9, 0x20, 0xc8, 0xd2, 0xc1, 0xce, 0xd1, 0xd4, 0x20, 0xda,
      0xce, 0xc1, 0xce, 0xc9, 0xd1, 0x2e, 0x0a,
    ],
  },
  {
    encoding: "cp866",
    bytes: [
      0x8f, 0xe0, 0xa8, 0xa2, 0xa5, 0xe2, 0x20, 0xac, 0xa8, 0xe0, 0x2e, 0x20, 0x84, 0xae, 0xaa,
      0xe3, 0xac, 0xa5, 0xad, 0xe2, 0xeb, 0x20, 0xe5, 0xe0, 0xa0, 0xad, 0xef, 0xe2, 0x20, 0xa7,
      0xad, 0xa0, 0xad, 0xa8, 0xef, 0x2e, 0x0a,
    ],
  },
  {
    encoding: "iso-8859-5",
    bytes: [
      0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2, 0x20, 0xdc, 0xd8, 0xe0, 0x2e, 0x20, 0xb4, 0xde, 0xda,
      0xe3, 0xdc, 0xd5, 0xdd, 0xe2, 0xeb, 0x20, 0xe5, 0xe0, 0xd0, 0xdd, 0xef, 0xe2, 0x20, 0xd7,
      0xdd, 0xd0, 0xdd, 0xd8, 0xef, 0x2e, 0x0a,
    ],
  },
] as const satisfies readonly {
  readonly encoding: RmemEncodingName;
  readonly bytes: readonly number[];
}[]);

describe("legacy Cyrillic detector", () => {
  it.each(CYRILLIC_FIXTURES)(
    "selects $encoding for a focused Cyrillic fixture",
    ({ encoding, bytes }) => {
      const result = detectLegacyEncoding(new Uint8Array(bytes), {
        profile: LEGACY_CYRILLIC_PROFILE,
      });

      expect(result.candidates[0]).toMatchObject({
        encoding,
        source: "heuristic",
        bomLength: 0,
      });
      expect(result.candidates[0]?.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.heuristic).toMatchObject({
        byteLength: bytes.length,
        highByteCount: bytes.filter((byte) => byte >= 0x80).length,
        asciiOnly: false,
      });
      expect(result.heuristic?.scores.find((score) => score.encoding === encoding)).toMatchObject({
        cyrillicRatio: 1,
        commonCyrillicPairRatio: 1,
      });
      expect(result.ignoredReason).toBeUndefined();
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.candidates)).toBe(true);
      expect(Object.isFrozen(result.heuristic?.scores)).toBe(true);
    },
  );

  it("detects Windows-1252 only when the active profile allows it", () => {
    const bytes = new Uint8Array([
      0x43, 0x61, 0x66, 0xe9, 0x20, 0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x20, 0x64, 0xe9, 0x6a,
      0xe0, 0x20, 0x76, 0x75, 0x20, 0x97, 0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x20, 0x66, 0x61,
      0xe7, 0x61, 0x64, 0x65, 0x2e, 0x0a,
    ]);
    const webResult = detectLegacyEncoding(bytes, {
      profile: WEB_COMPAT_PROFILE,
    });

    expect(webResult.candidates[0]).toMatchObject({
      encoding: "windows-1252",
      source: "heuristic",
    });
    expect(
      webResult.heuristic?.scores.find((score) => score.encoding === "windows-1252"),
    ).toMatchObject({
      latinLetterRatio: 1,
    });

    const legacyResult = detectLegacyEncoding(bytes, {
      profile: LEGACY_CYRILLIC_PROFILE,
    });

    expect(legacyResult.candidates.map((candidate) => candidate.encoding)).not.toContain(
      "windows-1252",
    );
  });

  it("does not run when profile legacy heuristics are disabled", () => {
    const result = detectLegacyEncoding(new Uint8Array([0xcf, 0xf0, 0xe8]), {
      profile: STRICT_UTF8_PROFILE,
    });

    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toBeUndefined();
    expect(result.ignoredReason).toBe("heuristics-disabled");
  });

  it("does not let legacy heuristics override explicit encoding or BOM", () => {
    const explicitEncoding = normalizeEncodingLabel("utf-8", {
      source: "explicit",
      profile: RMEM_PROFILE,
    });
    const explicitResult = detectLegacyEncoding(new Uint8Array([0xcf, 0xf0, 0xe8]), {
      explicitEncoding,
    });

    expect(explicitResult.candidates).toEqual([]);
    expect(explicitResult.heuristic).toBeUndefined();
    expect(explicitResult.ignoredReason).toBe("explicit-encoding");

    const bomResult = detectLegacyEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0xcf, 0xf0, 0xe8]));

    expect(bomResult.candidates).toEqual([]);
    expect(bomResult.bom?.encoding).toBe("utf-8");
    expect(bomResult.ignoredReason).toBe("bom");
  });

  it("respects the rmem rule that valid UTF-8 suppresses legacy heuristics", () => {
    const result = detectLegacyEncoding(
      new TextEncoder().encode("\u041f\u0440\u0438\u0432\u0456\u0442"),
      {
        profile: RMEM_PROFILE,
        utf8Validation: {
          valid: true,
        },
      },
    );

    expect(result.candidates).toEqual([]);
    expect(result.heuristic).toBeUndefined();
    expect(result.ignoredReason).toBe("valid-utf8");
  });

  it("keeps ASCII-only input from receiving high-confidence legacy candidates", () => {
    const result = detectLegacyEncoding(new Uint8Array([0x23, 0x20, 0x54, 0x69, 0x74, 0x6c, 0x65]));

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ignoredReason).toBe("ascii-only");
    expect(result.heuristic).toMatchObject({
      highByteCount: 0,
      asciiOnly: true,
    });
  });

  it("reports ambiguous legacy candidates with close confidence scores", () => {
    const result = detectLegacyEncoding(new Uint8Array([0xe0, 0xe0, 0xe0, 0xe0, 0xe0, 0xe0]), {
      profile: LEGACY_CYRILLIC_PROFILE,
      allowedEncodings: ["cp866", "iso-8859-5"],
    });

    expect(
      result.candidates.map((candidate) => [candidate.encoding, candidate.confidence]),
    ).toEqual([
      ["iso-8859-5", 0.6],
      ["cp866", 0.6],
    ]);
    const ambiguousWarning = result.warnings.find(
      (warning) => warning.code === "ENCODING_AMBIGUOUS_CANDIDATES",
    );

    expect(ambiguousWarning).toMatchObject({
      code: "ENCODING_AMBIGUOUS_CANDIDATES",
      message: "Legacy heuristic produced ambiguous candidates.",
      details: {
        selected: {
          encoding: "iso-8859-5",
          source: "heuristic",
        },
        candidates: [
          {
            encoding: "cp866",
            source: "heuristic",
          },
        ],
      },
    });
  });

  it("returns structured failures for malformed detector options", () => {
    expect(() =>
      detectLegacyEncoding(new Uint8Array([0xcf]), {
        allowedEncodings: ["utf-8", "shift-jis" as RmemEncodingName],
      }),
    ).toThrow(EncodingError);

    const result = tryDetectLegacyEncoding(new Uint8Array([0xcf]), {
      utf8Validation: {
        valid: "yes" as unknown as boolean,
      },
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "ENCODING_UNSUPPORTED_ENCODING",
        message: "UTF-8 validation signal must include a boolean valid field.",
        details: {
          option: "utf8Validation.valid",
          valueType: "string",
        },
      });
    }
  });
});
