import { describe, expect, it } from "vitest";

import { EncodingError } from "../src/index.js";
import type { EncodingProfile } from "../src/index.js";
import {
  normalizeDecodeDocumentOptions,
  normalizeDetectEncodingOptions,
} from "../src/encoding/OptionsNormalization.js";

describe("decode and detect options normalization", () => {
  it("normalizes default relicmem decode options into a fully validated immutable shape", () => {
    const options = normalizeDecodeDocumentOptions();

    expect(options.profile).toMatchObject({
      name: "relicmem",
      defaultEncoding: "utf-8",
      minConfidence: 0.75,
      legacyHeuristics: true,
      utf16Heuristics: true,
      metadataSniffing: false,
    });
    expect(options.allowedEncodings).toEqual([
      "utf-8",
      "utf-16le",
      "utf-16be",
      "windows-1251",
      "windows-1252",
      "iso-8859-1",
      "iso-8859-5",
      "koi8-r",
      "cp866",
    ]);
    expect(options.defaultEncoding).toEqual({
      inputLabel: "utf-8",
      canonical: "utf-8",
      aliases: ["utf8", "unicode-1-1-utf-8"],
      source: "profile",
    });
    expect(options.stripBom).toBe(true);
    expect(options.sourceMap).toBe("exact");
    expect(options.replacementPolicy).toBe("fatal");
    expect(options.replacementCharacter).toBe("\uFFFD");
    expect(options.backendPreference).toEqual([
      "native",
      "text-decoder",
      "iconv-lite",
      "exodus-bytes",
    ]);
    expect(options.sampleSizeBytes).toBe(64 * 1024);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.profile)).toBe(true);
    expect(Object.isFrozen(options.allowedEncodings)).toBe(true);
    expect(Object.isFrozen(options.backendPreference)).toBe(true);
  });

  it("normalizes detect options through the same profile, label and confidence rules", () => {
    const options = normalizeDetectEncodingOptions({
      profile: "webCompat",
      explicitEncoding: "latin1",
      allowedEncodings: ["utf-8", "windows-1252"],
      minConfidence: 0.25,
      metadata: {
        declaredEncoding: "iso-8859-1",
        contentType: "text/html; charset=iso-8859-1",
      },
      sampleSizeBytes: 4096,
    });

    expect(options.profile.name).toBe("webCompat");
    expect(options.defaultEncoding).toMatchObject({
      canonical: "windows-1252",
      source: "profile",
    });
    expect(options.explicitEncoding).toMatchObject({
      inputLabel: "latin1",
      canonical: "windows-1252",
      source: "explicit",
    });
    expect(options.allowedEncodings).toEqual(["utf-8", "windows-1252"]);
    expect(options.minConfidence).toBe(0.25);
    expect(options.metadata).toEqual({
      declaredEncoding: "iso-8859-1",
      contentType: "text/html; charset=iso-8859-1",
    });
    expect(options.sampleSizeBytes).toBe(4096);
    expect(Object.isFrozen(options.metadata)).toBe(true);
    expect("stripBom" in options).toBe(false);
    expect("backendPreference" in options).toBe(false);
  });

  it("applies profile decode defaults while allowing explicit decode overrides", () => {
    const options = normalizeDecodeDocumentOptions({
      profile: "legacyCyrillic",
      replacementPolicy: "fatal",
      replacementCharacter: "??",
      sourceMap: "line",
      stripBom: false,
      backendPreference: ["iconv-lite", "native", "iconv-lite"],
    });

    expect(options.profile).toMatchObject({
      name: "legacyCyrillic",
      defaultEncoding: "windows-1251",
      legacyHeuristics: true,
      utf16Heuristics: false,
    });
    expect(options.allowedEncodings).toEqual([
      "utf-8",
      "windows-1251",
      "koi8-r",
      "cp866",
      "iso-8859-5",
    ]);
    expect(options.defaultEncoding).toMatchObject({
      canonical: "windows-1251",
      source: "profile",
    });
    expect(options.replacementPolicy).toBe("fatal");
    expect(options.replacementCharacter).toBe("??");
    expect(options.sourceMap).toBe("line");
    expect(options.stripBom).toBe(false);
    expect(options.backendPreference).toEqual(["iconv-lite", "native"]);
  });

  it("rejects explicit and default encodings outside the normalized allowed list", () => {
    expect(() =>
      normalizeDetectEncodingOptions({
        explicitEncoding: "windows-1251",
        allowedEncodings: ["utf-8"],
      }),
    ).toThrow(EncodingError);

    try {
      normalizeDecodeDocumentOptions({
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

  it("rejects option lists that try to expand the active profile policy", () => {
    expect(() =>
      normalizeDetectEncodingOptions({
        profile: "strictUtf8",
        allowedEncodings: ["utf-8", "windows-1251"],
      }),
    ).toThrow(EncodingError);
  });

  it("validates numeric and enum option domains as fatal EncodingError values", () => {
    expect(() => normalizeDetectEncodingOptions({ minConfidence: 1.1 })).toThrow(EncodingError);
    expect(() => normalizeDetectEncodingOptions({ sampleSizeBytes: 0 })).toThrow(EncodingError);
    expect(() =>
      normalizeDecodeDocumentOptions({
        sourceMap: "full" as "exact",
      }),
    ).toThrow(EncodingError);
    expect(() =>
      normalizeDecodeDocumentOptions({
        backendPreference: [],
      }),
    ).toThrow(EncodingError);
  });

  it("supports validated custom profiles without retaining caller-owned arrays", () => {
    const allowedEncodings = ["utf-8", "windows-1251"] as const;
    const profile: EncodingProfile = {
      name: "importProfile",
      allowedEncodings,
      asciiCompatibleEncodings: ["utf-8", "windows-1251"],
      nativeByteSafeEncodings: ["utf-8"],
      defaultEncoding: "windows-1251",
      minConfidence: 0.8,
      legacyHeuristics: true,
      utf16Heuristics: false,
      metadataSniffing: true,
    };

    const options = normalizeDetectEncodingOptions({
      profile,
      allowedEncodings: ["windows-1251", "windows-1251"],
    });

    expect(options.profile).toEqual(profile);
    expect(options.profile).not.toBe(profile);
    expect(options.allowedEncodings).toEqual(["windows-1251"]);
    expect(options.defaultEncoding).toMatchObject({
      canonical: "windows-1251",
      source: "profile",
    });
    expect(Object.isFrozen(options.profile.allowedEncodings)).toBe(true);
  });
});
