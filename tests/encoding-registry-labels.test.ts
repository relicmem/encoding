import { describe, expect, it } from "vitest";

import {
  EncodingError,
  RELICMEM_ENCODING_NAMES,
  aliasesForEncoding,
  isRelicMEMEncodingName,
  normalizeEncodingLabel,
  tryNormalizeEncodingLabel,
} from "../src/index.js";

describe("encoding registry and label normalization", () => {
  it("exposes the stable lowercase canonical encoding set", () => {
    expect(RELICMEM_ENCODING_NAMES).toEqual([
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
    expect(Object.isFrozen(RELICMEM_ENCODING_NAMES)).toBe(true);
    expect(RELICMEM_ENCODING_NAMES.every((encoding) => encoding === encoding.toLowerCase())).toBe(
      true,
    );
    expect(isRelicMEMEncodingName("windows-1251")).toBe(true);
    expect(isRelicMEMEncodingName("utf8")).toBe(false);
  });

  it("normalizes common strict labels to canonical names with stable aliases", () => {
    expect(normalizeEncodingLabel(" UTF8 ")).toEqual({
      inputLabel: " UTF8 ",
      canonical: "utf-8",
      aliases: ["utf8", "unicode-1-1-utf-8"],
      source: "explicit",
    });
    expect(normalizeEncodingLabel("win1251", { source: "metadata" })).toEqual({
      inputLabel: "win1251",
      canonical: "windows-1251",
      aliases: ["cp1251", "windows1251", "win1251", "x-cp1251"],
      source: "metadata",
    });
    expect(normalizeEncodingLabel("cp-866")).toMatchObject({
      canonical: "cp866",
      aliases: ["cp-866", "866", "ibm866", "csibm866"],
    });
    expect(normalizeEncodingLabel("latin1")).toMatchObject({
      canonical: "iso-8859-1",
      aliases: ["iso8859-1", "iso88591", "iso-8859-1:1987", "latin1", "l1"],
    });
  });

  it("makes webCompat WHATWG remapping visible in the normalized label", () => {
    const label = normalizeEncodingLabel("iso-8859-1", {
      source: "metadata",
      profile: "webCompat",
    });

    expect(label.inputLabel).toBe("iso-8859-1");
    expect(label.canonical).toBe("windows-1252");
    expect(label.source).toBe("metadata");
    expect(label.aliases).toContain("cp1252");
    expect(label.aliases).toContain("iso-8859-1");
    expect(label.aliases).toContain("latin1");

    expect(normalizeEncodingLabel("latin1", { compatibility: "web" }).canonical).toBe(
      "windows-1252",
    );
    expect(
      normalizeEncodingLabel("iso-8859-1", {
        profile: "webCompat",
        compatibility: "strict",
      }).canonical,
    ).toBe("iso-8859-1");
  });

  it("returns immutable alias lists for strict and web-compatible policies", () => {
    const strictAliases = aliasesForEncoding("windows-1252");
    const webAliases = aliasesForEncoding("windows-1252", { profile: "webCompat" });

    expect(strictAliases).toEqual(["cp1252", "windows1252", "win1252", "x-cp1252"]);
    expect(webAliases).toContain("iso-8859-1");
    expect(webAliases).toContain("us-ascii");
    expect(Object.isFrozen(strictAliases)).toBe(true);
    expect(Object.isFrozen(webAliases)).toBe(true);
    expect(() => {
      (webAliases as string[]).push("mutated");
    }).toThrow(TypeError);
  });

  it("reports unsupported labels as controlled EncodingError results", () => {
    expect(() => normalizeEncodingLabel("shift_jis")).toThrow(EncodingError);

    const result = tryNormalizeEncodingLabel("shift_jis", { source: "metadata" });
    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected unsupported label failure.");
    }

    expect(result.error.code).toBe("ENCODING_UNSUPPORTED_LABEL");
    expect(result.error.details).toEqual({
      label: "shift-jis",
      source: "metadata",
      compatibility: "strict",
    });
  });
});
