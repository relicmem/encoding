import { describe, expect, expectTypeOf, it } from "vitest";

import { EncodingError, detectEncoding } from "../src/index.js";
import type { DetectEncodingFunction, EncodingDetectionResult } from "../src/index.js";

describe("public detectEncoding API", () => {
  it("exports the public detection-only function with the stable contract signature", () => {
    expectTypeOf(detectEncoding).toEqualTypeOf<DetectEncodingFunction>();
  });

  it("returns the public detection result shape without decoded document state", () => {
    const result = detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]));

    expectTypeOf(result).toEqualTypeOf<EncodingDetectionResult>();
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
      backend: {
        name: "native",
        exactSourceMap: false,
      },
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual(["bom", "fallback"]);
    expect(result.warnings).toEqual([]);
    expect("text" in result).toBe(false);
    expect("offsetMap" in result).toBe(false);
    expect("lineIndex" in result).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.label)).toBe(true);
    expect(Object.isFrozen(result.backend)).toBe(true);
  });

  it("runs synchronously against the configured byte sample", () => {
    const result = detectEncoding(new Uint8Array([0x41, 0xc3, 0x28]), {
      profile: "strictUtf8",
      sampleSizeBytes: 1,
    });

    expect(result).toMatchObject({
      encoding: "utf-8",
      confidence: 1,
      source: "utf8-validation",
    });
    expect(result.candidates.map((candidate) => candidate.source)).toEqual([
      "utf8-validation",
      "fallback",
    ]);
  });

  it("rejects non-byte input before running detection", () => {
    expect(() => detectEncoding("text" as unknown as Uint8Array)).toThrow(EncodingError);

    try {
      detectEncoding("text" as unknown as Uint8Array);
      throw new Error("Expected byte input validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).message).toBe(
        "Composite detection input must be a Uint8Array.",
      );
      expect((error as EncodingError).details).toEqual({
        inputType: "string",
      });
    }
  });

  it("surfaces fatal option conflicts from public options normalization", () => {
    expect(() =>
      detectEncoding(new Uint8Array([0x41]), {
        explicitEncoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      }),
    ).toThrow(EncodingError);

    try {
      detectEncoding(new Uint8Array([0x41]), {
        defaultEncoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      });
      throw new Error("Expected default encoding conflict.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toEqual({
        option: "defaultEncoding",
        encoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      });
    }
  });
});
