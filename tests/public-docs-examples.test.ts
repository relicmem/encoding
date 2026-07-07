import { describe, expect, it } from "vitest";

import {
  BUILT_IN_ENCODING_PROFILES,
  createDecodingStream,
  decodeDocument,
  decodeDocumentSync,
  detectEncoding,
  encodeText,
  tryDecodeDocument,
  tryEncodeText,
} from "../src/index.js";
import type { DecodedChunk, DecodedDocument, EncodingProfile } from "../src/index.js";
import { loadFixture } from "./support/fixtures.js";

const encoder = new TextEncoder();

type ParserIntegrationMode = "native-byte-safe" | "transcode-compatibility";

describe("public documentation examples", () => {
  it("decodes byte input with the default relicmem integration profile", async () => {
    const bytes = encoder.encode("# Title\nПривіт\n");
    const decoded = await decodeDocument(bytes, {
      profile: "relicmem",
      sourceMap: "exact",
    });

    expect(decoded.text).toBe("# Title\nПривіт\n");
    expect(decoded.detection).toMatchObject({
      encoding: "utf-8",
      source: "utf8-validation",
      confidence: 1,
    });
    expect(decoded.lineIndex.lineCount).toBe(3);
    expect(decoded.lineIndex.lineTextRange(2)).toEqual({ start: 8, end: 14 });
    expect(decoded.lineIndex.lineByteRange(2)).toEqual({ start: 8, end: 20 });
    expect(decoded.warnings).toEqual([]);
  });

  it("uses detect-only API for routing without decoding a full document", () => {
    const detection = detectEncoding(encoder.encode("Cafe"), {
      profile: "webCompat",
      metadata: {
        contentType: "text/html; charset=latin1",
      },
    });

    expect(detection).toMatchObject({
      encoding: "windows-1252",
      source: "metadata",
      label: {
        inputLabel: "latin1",
        canonical: "windows-1252",
        source: "metadata",
      },
    });
    expect(detection.label.aliases).toContain("iso-8859-1");
  });

  it("shows strictUtf8 as a narrow profile for new documents", async () => {
    const decoded = decodeDocumentSync(encoder.encode("New document"), {
      profile: "strictUtf8",
    });
    const result = await tryDecodeDocument(new Uint8Array([0xc3, 0x28]), {
      profile: "strictUtf8",
    });

    expect(decoded.text).toBe("New document");
    expect(decoded.detection.encoding).toBe("utf-8");
    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("Expected invalid UTF-8 to fail under strictUtf8.");
    }

    expect(result.error.code).toBe("ENCODING_INVALID_SEQUENCE");
    expect(result.error.byteRange).toEqual({ start: 0, end: 1 });
  });

  it("decodes legacy Cyrillic input with the legacyCyrillic profile", async () => {
    const fixture = await loadFixture("windows1251-uk");
    const decoded = await decodeDocument(fixture.bytes, {
      profile: "legacyCyrillic",
    });

    expect(decoded.text).toBe(fixture.metadata.expected.text);
    expect(decoded.detection).toMatchObject({
      encoding: "windows-1251",
      source: "heuristic",
    });
    expect(decoded.detection.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("uses webCompat metadata and WHATWG label remapping for web content", async () => {
    const decoded = await decodeDocument(new Uint8Array([0x43, 0x61, 0x66, 0xe9]), {
      profile: "webCompat",
      metadata: {
        contentType: "text/html; charset=latin1",
      },
      sourceMap: "none",
    });

    expect(decoded.text).toBe("Café");
    expect(decoded.detection).toMatchObject({
      encoding: "windows-1252",
      source: "metadata",
      label: {
        inputLabel: "latin1",
        canonical: "windows-1252",
      },
    });
  });

  it("encodes parser trigger fragments through the package root", () => {
    const trigger = encodeText("#", "windows-1251");
    const unsupported = tryEncodeText("A\ud83d\ude00", "windows-1251");
    const replaced = encodeText("A\ud83d\ude00", "windows-1251", {
      replacementPolicy: "replace",
    });

    expect([...trigger.bytes]).toEqual([0x23]);
    expect(trigger.encoding).toBe("windows-1251");
    expect(unsupported.ok).toBe(false);
    expect([...replaced.bytes]).toEqual([0x41, 0x3f]);
    expect(replaced.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_UNMAPPABLE_CHARACTER_REPLACED",
    ]);
  });

  it("keeps stream chunks and final document ranges source-aware", () => {
    const stream = createDecodingStream({
      profile: "relicmem",
      sourceMap: "exact",
      sampleSizeBytes: 4,
    });
    const chunks = [
      new Uint8Array([0x41, 0xe2]),
      new Uint8Array([0x82, 0xac, 0xd0]),
      new Uint8Array([0x96, 0x0a]),
    ];
    const decodedChunks = chunks.flatMap((chunk) => stream.write(chunk));
    const document = stream.end();

    expect(decodedChunks.map((chunk) => chunk.text).join("")).toBe("A€Ж\n");
    expect(decodedChunks.every(isContinuousChunk)).toBe(true);
    expect(document.text).toBe("A€Ж\n");
    expect(document.offsetMap.byteRangeForTextRange({ start: 1, end: 2 })).toEqual({
      start: 1,
      end: 4,
    });
  });

  it("maps decoded text ranges back to original bytes and line positions", () => {
    const decoded = decodeDocumentSync(new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0a, 0xd0, 0x96]), {
      profile: "relicmem",
      sourceMap: "exact",
    });

    expect(decoded.text).toBe("#\nЖ");
    expect(decoded.offsetMap.segments()[0]).toEqual({
      byteRange: { start: 0, end: 3 },
      textRange: { start: 0, end: 0 },
      kind: "bom",
    });
    expect(decoded.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 3,
      end: 4,
    });
    expect(decoded.lineIndex.lineByteRange(2)).toEqual({ start: 5, end: 7 });
  });

  it("documents the string input caveat through the synthetic byte warning", () => {
    const decoded = decodeDocumentSync("Привіт", {
      sourceMap: "exact",
    });

    expect(decoded.text).toBe("Привіт");
    expect(decoded.warnings.map((warning) => warning.code)).toEqual([
      "ENCODING_TEXT_INPUT_SYNTHETIC_BYTES",
    ]);
    expect(decoded.offsetMap.segments().every((segment) => segment.kind === "synthetic")).toBe(
      true,
    );
  });

  it("selects parser integration mode from public document and profile metadata", () => {
    const byteSafeDocument = decodeDocumentSync(encoder.encode("# UTF-8"), {
      profile: "relicmem",
    });
    const utf16Document = decodeDocumentSync(new Uint8Array([0xff, 0xfe, 0x23, 0x00]), {
      profile: "relicmem",
    });
    const profile = BUILT_IN_ENCODING_PROFILES.relicmem;

    expect(parserIntegrationModeFor(byteSafeDocument, profile)).toBe("native-byte-safe");
    expect(parserIntegrationModeFor(utf16Document, profile)).toBe("transcode-compatibility");
    expect(utf16Document.offsetMap.byteRangeForTextRange({ start: 0, end: 1 })).toEqual({
      start: 2,
      end: 4,
    });
  });
});

function parserIntegrationModeFor(
  document: Pick<DecodedDocument, "detection">,
  profile: Pick<EncodingProfile, "nativeByteSafeEncodings">,
): ParserIntegrationMode {
  return profile.nativeByteSafeEncodings.includes(document.detection.encoding)
    ? "native-byte-safe"
    : "transcode-compatibility";
}

function isContinuousChunk(chunk: DecodedChunk, index: number, chunks: readonly DecodedChunk[]) {
  const previous = chunks[index - 1];

  if (previous === undefined) {
    return chunk.byteRange.start === 0 && chunk.charRange.start === 0;
  }

  return (
    chunk.byteRange.start === previous.byteRange.end &&
    chunk.charRange.start === previous.charRange.end
  );
}
