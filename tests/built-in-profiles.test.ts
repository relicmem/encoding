import { describe, expect, it } from "vitest";

import { EncodingError, normalizeEncodingLabel } from "../src/index.js";
import type { EncodingProfile } from "../src/index.js";
import {
  BUILT_IN_ENCODING_PROFILE_POLICIES,
  BUILT_IN_ENCODING_PROFILES,
  DEFAULT_ENCODING_PROFILE_NAME,
  LEGACY_CYRILLIC_ENCODINGS,
  LEGACY_CYRILLIC_PROFILE,
  RMEM_PROFILE,
  STRICT_UTF8_PROFILE,
  WEB_COMPAT_PROFILE,
  resolveEncodingProfilePolicy,
} from "../src/profile/EncodingProfiles.js";

describe("built-in encoding profiles", () => {
  it("uses rmem as the default CLI/import profile policy", () => {
    const policy = resolveEncodingProfilePolicy();

    expect(DEFAULT_ENCODING_PROFILE_NAME).toBe("rmem");
    expect(policy).toBe(BUILT_IN_ENCODING_PROFILE_POLICIES.rmem);
    expect(policy.profile).toEqual(RMEM_PROFILE);
    expect(policy.profile).toMatchObject({
      name: "rmem",
      defaultEncoding: "utf-8",
      minConfidence: 0.75,
      legacyHeuristics: true,
      utf16Heuristics: true,
      metadataSniffing: false,
    });
    expect(policy.profile.allowedEncodings).toEqual([
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
    expect(policy.replacementPolicy).toBe("fatal");
    expect(policy.sourceMap).toBe("exact");
    expect(policy.backendPreference).toEqual([
      "native",
      "text-decoder",
      "iconv-lite",
      "exodus-bytes",
    ]);
  });

  it("makes strictUtf8 a narrow non-legacy policy", () => {
    const policy = resolveEncodingProfilePolicy("strictUtf8");

    expect(policy.profile).toEqual(STRICT_UTF8_PROFILE);
    expect(policy.profile.allowedEncodings).toEqual(["utf-8"]);
    expect(policy.profile.asciiCompatibleEncodings).toEqual(["utf-8"]);
    expect(policy.profile.nativeByteSafeEncodings).toEqual(["utf-8"]);
    expect(policy.profile.legacyHeuristics).toBe(false);
    expect(policy.profile.utf16Heuristics).toBe(false);
    expect(policy.profile.metadataSniffing).toBe(false);
    expect(policy.profile.minConfidence).toBe(1);
    expect(policy.replacementPolicy).toBe("fatal");
  });

  it("focuses legacyCyrillic on Cyrillic import candidates", () => {
    const policy = resolveEncodingProfilePolicy("legacyCyrillic");

    expect(LEGACY_CYRILLIC_ENCODINGS).toEqual([
      "utf-8",
      "windows-1251",
      "koi8-r",
      "cp866",
      "iso-8859-5",
    ]);
    expect(policy.profile).toEqual(LEGACY_CYRILLIC_PROFILE);
    expect(policy.profile.allowedEncodings).toEqual(LEGACY_CYRILLIC_ENCODINGS);
    expect(policy.profile.allowedEncodings).not.toContain("windows-1252");
    expect(policy.profile.allowedEncodings).not.toContain("utf-16le");
    expect(policy.profile.defaultEncoding).toBe("windows-1251");
    expect(policy.profile.legacyHeuristics).toBe(true);
    expect(policy.profile.utf16Heuristics).toBe(false);
    expect(policy.replacementPolicy).toBe("replace");
  });

  it("enables web-compatible label behavior and metadata sniffing", () => {
    const policy = resolveEncodingProfilePolicy("webCompat");
    const label = normalizeEncodingLabel("iso-8859-1", {
      source: "metadata",
      profile: policy.profile,
    });

    expect(policy.profile).toEqual(WEB_COMPAT_PROFILE);
    expect(policy.profile.defaultEncoding).toBe("windows-1252");
    expect(policy.profile.metadataSniffing).toBe(true);
    expect(policy.profile.legacyHeuristics).toBe(true);
    expect(policy.backendPreference).toEqual([
      "native",
      "text-decoder",
      "exodus-bytes",
      "iconv-lite",
    ]);
    expect(label).toMatchObject({
      inputLabel: "iso-8859-1",
      canonical: "windows-1252",
      source: "metadata",
    });
  });

  it("freezes built-in profile metadata and policy defaults", () => {
    expect(BUILT_IN_ENCODING_PROFILES.rmem).toBe(RMEM_PROFILE);
    expect(Object.isFrozen(BUILT_IN_ENCODING_PROFILES)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_ENCODING_PROFILE_POLICIES)).toBe(true);

    for (const profile of Object.values(BUILT_IN_ENCODING_PROFILES)) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.allowedEncodings)).toBe(true);
      expect(Object.isFrozen(profile.asciiCompatibleEncodings)).toBe(true);
      expect(Object.isFrozen(profile.nativeByteSafeEncodings)).toBe(true);
    }

    for (const policy of Object.values(BUILT_IN_ENCODING_PROFILE_POLICIES)) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.backendPreference)).toBe(true);
    }
  });

  it("validates custom profiles and does not retain caller-owned arrays", () => {
    const allowedEncodings = ["utf-8", "windows-1251"] as const;
    const profile: EncodingProfile = {
      name: "customImport",
      allowedEncodings,
      asciiCompatibleEncodings: ["utf-8", "windows-1251"],
      nativeByteSafeEncodings: ["utf-8"],
      defaultEncoding: "windows-1251",
      minConfidence: 0.7,
      legacyHeuristics: true,
      utf16Heuristics: false,
      metadataSniffing: true,
    };

    const policy = resolveEncodingProfilePolicy(profile);

    expect(policy.profile).toEqual(profile);
    expect(policy.profile).not.toBe(profile);
    expect(policy.profile.allowedEncodings).toEqual(["utf-8", "windows-1251"]);
    expect(Object.isFrozen(policy.profile.allowedEncodings)).toBe(true);
    expect(policy.replacementPolicy).toBe("fatal");
    expect(policy.backendPreference).toEqual([
      "native",
      "text-decoder",
      "iconv-lite",
      "exodus-bytes",
    ]);
  });

  it("rejects malformed custom profiles as fatal EncodingError values", () => {
    expect(() =>
      resolveEncodingProfilePolicy({
        name: "bad",
        allowedEncodings: ["utf-8"],
        asciiCompatibleEncodings: ["utf-8", "windows-1251"],
        nativeByteSafeEncodings: ["utf-8"],
        defaultEncoding: "utf-8",
        minConfidence: 0.5,
        legacyHeuristics: false,
        utf16Heuristics: false,
        metadataSniffing: false,
      }),
    ).toThrow(EncodingError);

    expect(() => resolveEncodingProfilePolicy("universal" as "rmem")).toThrow(EncodingError);
  });
});
