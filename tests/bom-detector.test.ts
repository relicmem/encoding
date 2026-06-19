import { describe, expect, it } from "vitest";

import { EncodingError, normalizeEncodingLabel } from "../src/index.js";
import type { RmemEncodingName } from "../src/index.js";
import { detectByteOrderMark, tryDetectByteOrderMark } from "../src/detector/BomDetector.js";
import { sniffEncodingMetadata } from "../src/encoding/MetadataSniffing.js";
import { WEB_COMPAT_PROFILE } from "../src/profile/EncodingProfiles.js";

describe("BOM detector", () => {
  it.each([
    {
      encoding: "utf-8",
      bytes: [0xef, 0xbb, 0xbf, 0x23],
      bomLength: 3,
      reason: "UTF-8 byte order mark.",
    },
    {
      encoding: "utf-16le",
      bytes: [0xff, 0xfe, 0x23, 0x00],
      bomLength: 2,
      reason: "UTF-16LE byte order mark.",
    },
    {
      encoding: "utf-16be",
      bytes: [0xfe, 0xff, 0x00, 0x23],
      bomLength: 2,
      reason: "UTF-16BE byte order mark.",
    },
  ] satisfies readonly {
    readonly encoding: RmemEncodingName;
    readonly bytes: readonly number[];
    readonly bomLength: number;
    readonly reason: string;
  }[])(
    "recognizes $encoding BOM as a high-confidence BOM candidate",
    ({ encoding, bytes, bomLength, reason }) => {
      const result = detectByteOrderMark(new Uint8Array(bytes));

      expect(result.bom).toMatchObject({
        encoding,
        bomLength,
        byteRange: {
          start: 0,
          end: bomLength,
        },
        label: {
          inputLabel: encoding,
          canonical: encoding,
          source: "bom",
        },
      });
      expect(result.candidate).toEqual({
        encoding,
        confidence: 1,
        source: "bom",
        reason,
        bomLength,
      });
      expect(result.warnings).toEqual([]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.bom)).toBe(true);
      expect(Object.isFrozen(result.bom?.byteRange)).toBe(true);
      expect(Object.isFrozen(result.bom?.label.aliases)).toBe(true);
    },
  );

  it("does not match incomplete BOM prefixes on short inputs", () => {
    for (const bytes of [[], [0xef], [0xef, 0xbb], [0xff], [0xfe], [0x00, 0xfe, 0xff]]) {
      const result = detectByteOrderMark(new Uint8Array(bytes));

      expect(result).toEqual({
        warnings: [],
      });
      expect(result.bom).toBeUndefined();
      expect(result.candidate).toBeUndefined();
    }
  });

  it("reports explicit encoding conflicts without letting BOM override explicit encoding", () => {
    const explicitEncoding = normalizeEncodingLabel("windows-1251", {
      source: "explicit",
    });
    const result = detectByteOrderMark(new Uint8Array([0xef, 0xbb, 0xbf]), {
      explicitEncoding,
    });

    expect(result.bom?.encoding).toBe("utf-8");
    expect(result.candidate).toMatchObject({
      encoding: "utf-8",
      source: "bom",
      bomLength: 3,
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "ENCODING_BOM_CONFLICT",
      message: "BOM encoding conflicts with explicit encoding. Explicit encoding takes precedence.",
      byteRange: {
        start: 0,
        end: 3,
      },
      details: {
        bomEncoding: "utf-8",
        bomLength: 3,
        explicitEncoding: "windows-1251",
        explicitLabel: "windows-1251",
      },
    });
  });

  it("can turn explicit/BOM conflict into a fatal structured result", () => {
    const explicitEncoding = normalizeEncodingLabel("utf-8", {
      source: "explicit",
    });

    expect(() =>
      detectByteOrderMark(new Uint8Array([0xff, 0xfe]), {
        allowedEncodings: ["utf-8", "utf-16le"],
        explicitEncoding,
        conflictPolicy: "fatal",
      }),
    ).toThrow(EncodingError);

    const result = tryDetectByteOrderMark(new Uint8Array([0xff, 0xfe]), {
      allowedEncodings: ["utf-8", "utf-16le"],
      explicitEncoding,
      conflictPolicy: "fatal",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: "ENCODING_BOM_CONFLICT",
        message: "BOM encoding conflicts with explicit encoding.",
        byteRange: {
          start: 0,
          end: 2,
        },
        details: {
          bomEncoding: "utf-16le",
          explicitEncoding: "utf-8",
        },
      });
    }
  });

  it("does not silently ignore a BOM encoding that is not allowed and has no explicit override", () => {
    expect(() =>
      detectByteOrderMark(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
        allowedEncodings: ["utf-8"],
      }),
    ).toThrow(EncodingError);

    try {
      detectByteOrderMark(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
        allowedEncodings: ["utf-8"],
      });
      throw new Error("Expected disallowed BOM to be fatal.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_UNSUPPORTED_ENCODING");
      expect((error as EncodingError).details).toEqual({
        encoding: "utf-16le",
        bomLength: 2,
        allowedEncodings: ["utf-8"],
      });
    }
  });

  it("recognizes a disallowed BOM conflict without adding an unusable candidate", () => {
    const explicitEncoding = normalizeEncodingLabel("utf-8", {
      source: "explicit",
    });
    const result = detectByteOrderMark(new Uint8Array([0xfe, 0xff, 0x00, 0x23]), {
      allowedEncodings: ["utf-8"],
      explicitEncoding,
    });

    expect(result.bom?.encoding).toBe("utf-16be");
    expect(result.candidate).toBeUndefined();
    expect(result.warnings.map((warning) => warning.code)).toEqual(["ENCODING_BOM_CONFLICT"]);
  });

  it("passes BOM metadata to downstream metadata sniffing so metadata cannot override BOM", () => {
    const bomResult = detectByteOrderMark(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]));
    const bom = bomResult.bom;

    expect(bom).toBeDefined();

    if (bom === undefined) {
      throw new Error("Expected UTF-8 BOM.");
    }

    const metadataResult = sniffEncodingMetadata({
      profile: WEB_COMPAT_PROFILE,
      allowedEncodings: WEB_COMPAT_PROFILE.allowedEncodings,
      bom,
      metadata: {
        declaredEncoding: "windows-1251",
        sourceName: "web.md",
      },
    });

    expect(metadataResult.selectedLabel?.label.canonical).toBe("windows-1251");
    expect(metadataResult.candidate).toBeUndefined();
    expect(metadataResult.ignoredReason).toBe("bom");
    expect(metadataResult.warnings).toHaveLength(1);
    expect(metadataResult.warnings[0]).toMatchObject({
      code: "ENCODING_BOM_CONFLICT",
      message: "Metadata encoding conflicts with BOM and was ignored.",
      details: {
        higherPrioritySource: "bom",
        higherPriorityEncoding: "utf-8",
        bomLength: 3,
        sourceName: "web.md",
      },
    });
  });
});
