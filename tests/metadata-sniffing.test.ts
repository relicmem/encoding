import { describe, expect, it } from "vitest";

import { normalizeEncodingLabel } from "../src/index.js";
import {
  extractCharsetFromContentType,
  extractHtmlMetadataLabels,
  sniffEncodingMetadata,
} from "../src/encoding/MetadataSniffing.js";
import { normalizeDetectEncodingOptions } from "../src/encoding/OptionsNormalization.js";
import { RMEM_PROFILE, WEB_COMPAT_PROFILE } from "../src/profile/EncodingProfiles.js";

describe("metadata sniffing", () => {
  it("extracts content-type and HTML charset metadata as normalized metadata candidates", () => {
    const result = sniffEncodingMetadata({
      profile: WEB_COMPAT_PROFILE,
      allowedEncodings: WEB_COMPAT_PROFILE.allowedEncodings,
      metadata: {
        contentType: 'text/html; charset="iso-8859-1"',
        htmlHeadSample: '<head><meta charset="windows-1251"></head>',
        sourceName: "https://example.test/page.html",
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.sourceName).toBe("https://example.test/page.html");
    expect(result.labels.map((label) => [label.field, label.label.canonical])).toEqual([
      ["contentType", "windows-1252"],
      ["htmlHeadSample", "windows-1251"],
    ]);
    expect(result.selectedLabel).toMatchObject({
      field: "contentType",
      label: {
        inputLabel: "iso-8859-1",
        canonical: "windows-1252",
        source: "metadata",
      },
      confidence: 0.9,
    });
    expect(result.candidate).toEqual({
      encoding: "windows-1252",
      confidence: 0.9,
      source: "metadata",
      reason: "HTTP content-type charset.",
      bomLength: 0,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_METADATA_CONFLICT",
      details: {
        sourceName: "https://example.test/page.html",
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.labels)).toBe(true);
    expect(Object.isFrozen(result.warnings)).toBe(true);
  });

  it("keeps metadata disabled for profiles that do not opt into metadata sniffing", () => {
    const result = sniffEncodingMetadata({
      profile: RMEM_PROFILE,
      allowedEncodings: RMEM_PROFILE.allowedEncodings,
      metadata: {
        declaredEncoding: "windows-1251",
      },
    });

    expect(result).toMatchObject({
      enabled: false,
      labels: [],
      warnings: [],
      ignoredReason: "metadata-disabled",
    });
    expect(result.candidate).toBeUndefined();
  });

  it("does not let metadata override explicit encoding", () => {
    const explicitEncoding = normalizeEncodingLabel("utf-8", {
      source: "explicit",
      profile: WEB_COMPAT_PROFILE,
    });
    const result = sniffEncodingMetadata({
      profile: WEB_COMPAT_PROFILE,
      allowedEncodings: WEB_COMPAT_PROFILE.allowedEncodings,
      explicitEncoding,
      metadata: {
        declaredEncoding: "windows-1251",
        sourceName: "import.md",
      },
    });

    expect(result.selectedLabel?.label.canonical).toBe("windows-1251");
    expect(result.candidate).toBeUndefined();
    expect(result.ignoredReason).toBe("explicit-encoding");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_METADATA_CONFLICT",
      message: "Metadata encoding conflicts with explicit encoding and was ignored.",
      details: {
        higherPrioritySource: "explicit",
        higherPriorityEncoding: "utf-8",
        sourceName: "import.md",
      },
    });
  });

  it("does not let metadata override BOM", () => {
    const result = sniffEncodingMetadata({
      profile: WEB_COMPAT_PROFILE,
      allowedEncodings: WEB_COMPAT_PROFILE.allowedEncodings,
      bom: {
        encoding: "utf-8",
        bomLength: 3,
      },
      metadata: {
        declaredEncoding: "windows-1251",
      },
    });

    expect(result.selectedLabel?.label.canonical).toBe("windows-1251");
    expect(result.candidate).toBeUndefined();
    expect(result.ignoredReason).toBe("bom");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_BOM_CONFLICT",
      message: "Metadata encoding conflicts with BOM and was ignored.",
      details: {
        higherPrioritySource: "bom",
        higherPriorityEncoding: "utf-8",
        bomLength: 3,
      },
    });
  });

  it("turns invalid or disallowed metadata labels into warnings instead of fatal options errors", () => {
    const result = sniffEncodingMetadata({
      profile: WEB_COMPAT_PROFILE,
      allowedEncodings: ["utf-8"],
      metadata: {
        declaredEncoding: "shift_jis",
        contentType: "text/plain; charset=windows-1251",
        sourceName: "legacy.txt",
      },
    });

    expect(result.labels).toEqual([]);
    expect(result.candidate).toBeUndefined();
    expect(result.ignoredReason).toBe("unsupported-metadata");
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_UNSUPPORTED_LABEL",
      "ENCODING_UNSUPPORTED_ENCODING",
    ]);
    expect(result.warnings[0]?.details).toMatchObject({
      metadataField: "declaredEncoding",
      inputLabel: "shift_jis",
      sourceName: "legacy.txt",
    });
    expect(result.warnings[1]?.details).toMatchObject({
      metadataField: "contentType",
      inputLabel: "windows-1251",
      encoding: "windows-1251",
      allowedEncodings: ["utf-8"],
      sourceName: "legacy.txt",
    });
  });

  it("extracts charset values from content-type and HTML meta without full HTML parsing", () => {
    expect(extractCharsetFromContentType("text/html; boundary=x; charset='koi8-r'")).toBe("koi8-r");
    expect(extractCharsetFromContentType("text/plain")).toBeUndefined();

    expect(
      extractHtmlMetadataLabels(
        '<meta http-equiv="Content-Type" content="text/html; charset=cp-866">' +
          "<meta charset=windows-1251>",
      ).map((label) => [label.inputLabel, label.reason]),
    ).toEqual([
      ["cp-866", "HTML content-type meta charset."],
      ["windows-1251", "HTML meta charset."],
    ]);
  });

  it("adds the sniffed metadata signal to normalized detect options for web-compatible profiles", () => {
    const options = normalizeDetectEncodingOptions({
      profile: "webCompat",
      metadata: {
        htmlHeadSample: '<meta charset="latin1">',
      },
    });

    expect(options.metadataSniffing.enabled).toBe(true);
    expect(options.metadataSniffing.candidate).toMatchObject({
      encoding: "windows-1252",
      source: "metadata",
    });
    expect(options.metadataSniffing.selectedLabel?.label).toMatchObject({
      inputLabel: "latin1",
      canonical: "windows-1252",
      source: "metadata",
    });
  });
});
