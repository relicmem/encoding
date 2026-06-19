import { describe, expect, expectTypeOf, it } from "vitest";

import { decodeDocumentSync } from "../src/index.js";
import type { DecodedDocument, EncodingProfile, RmemEncodingName } from "../src/index.js";
import {
  ASCII_COMPATIBLE_ENCODINGS,
  BUILT_IN_ENCODING_PROFILES,
  RMEM_PROFILE,
  SINGLE_BYTE_ENCODINGS,
} from "../src/profile/EncodingProfiles.js";

type ParserIntegrationMode = "native-byte-safe" | "transcode-compatibility";

function parserIntegrationModeFor(
  document: Pick<DecodedDocument, "detection">,
  profile: Pick<EncodingProfile, "nativeByteSafeEncodings">,
): ParserIntegrationMode {
  return profile.nativeByteSafeEncodings.includes(document.detection.encoding)
    ? "native-byte-safe"
    : "transcode-compatibility";
}

describe("parser integration metadata", () => {
  it("exposes the public metadata shape needed to select a parser integration mode", () => {
    expectTypeOf<EncodingProfile>().toExtend<{
      readonly allowedEncodings: readonly RmemEncodingName[];
      readonly asciiCompatibleEncodings: readonly RmemEncodingName[];
      readonly nativeByteSafeEncodings: readonly RmemEncodingName[];
    }>();
    expectTypeOf<DecodedDocument["detection"]["encoding"]>().toExtend<RmemEncodingName>();
  });

  it("marks UTF-8 and ASCII-compatible single-byte encodings as native byte-safe", () => {
    expect(ASCII_COMPATIBLE_ENCODINGS).toEqual(["utf-8", ...SINGLE_BYTE_ENCODINGS]);
    expect(RMEM_PROFILE.nativeByteSafeEncodings).toEqual(ASCII_COMPATIBLE_ENCODINGS);
    expect(RMEM_PROFILE.asciiCompatibleEncodings).toEqual(ASCII_COMPATIBLE_ENCODINGS);
    expect(RMEM_PROFILE.allowedEncodings).toEqual([
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

    expect(RMEM_PROFILE.nativeByteSafeEncodings).not.toContain("utf-16le");
    expect(RMEM_PROFILE.nativeByteSafeEncodings).not.toContain("utf-16be");
  });

  it("lets parser integrations choose mode from DecodedDocument detection and public profile metadata", () => {
    const singleByteDocument = decodeDocumentSync(new Uint8Array([0xcf, 0xf0]), {
      profile: "rmem",
      explicitEncoding: "windows-1251",
    });
    const utf16Document = decodeDocumentSync(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
      profile: "rmem",
    });
    const profile = BUILT_IN_ENCODING_PROFILES.rmem;

    expect(singleByteDocument.text).toBe("Пр");
    expect(singleByteDocument.detection.encoding).toBe("windows-1251");
    expect(parserIntegrationModeFor(singleByteDocument, profile)).toBe("native-byte-safe");

    expect(utf16Document.text).toBe("#");
    expect(utf16Document.detection.encoding).toBe("utf-16le");
    expect(parserIntegrationModeFor(utf16Document, profile)).toBe("transcode-compatibility");
    expect(utf16Document.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 2,
      end: 4,
    });
  });
});
