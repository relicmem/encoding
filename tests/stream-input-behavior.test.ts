import { describe, expect, it } from "vitest";

import {
  EncodingError,
  createDecodingStream,
  decodeDocument,
  decodeDocumentSync,
} from "../src/index.js";
import type {
  DecodedChunk,
  DecodedDocument,
  DecodeDocumentOptions,
  EncodingWarning,
  RelicMEMEncodingName,
} from "../src/index.js";
import { loadFixture } from "./support/fixtures.js";

describe("stream and async input behavior", () => {
  it("decodes AsyncIterable and ReadableStream chunks equivalently to sync bytes", async () => {
    const fixture = await loadFixture("stream-split-utf8");
    const chunks = splitBytesAt(fixture.bytes, [2, 3, 5]);
    const options = { sourceMap: "exact" } satisfies DecodeDocumentOptions;
    const expected = decodeDocumentSync(fixture.bytes, options);

    const asyncDocument = await decodeDocument(createAsyncChunks(chunks), options);
    const readableStreamDocument = await decodeDocument(createReadableStream(chunks), options);

    expect(expected.text).toBe(fixture.metadata.expected.text);
    assertDocumentsEquivalent(asyncDocument, expected);
    assertDocumentsEquivalent(readableStreamDocument, expected);
  });

  it("decodes empty byte containers equivalently to empty Uint8Array input", async () => {
    const options = { sourceMap: "exact" } satisfies DecodeDocumentOptions;
    const expected = decodeDocumentSync(new Uint8Array(), options);
    const syncIterableDocument = decodeDocumentSync([], options);
    const asyncIterableDocument = await decodeDocument(createAsyncChunks([]), options);
    const readableStreamDocument = await decodeDocument(createReadableStream([]), options);

    expect(expected.text).toBe("");
    expect([...expected.bytes]).toEqual([]);
    expect(expected.offsetMap.segments()).toEqual([]);
    expect(expected.lineIndex.lineCount).toBe(1);
    expect(expected.lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 0 });
    expect(expected.lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 0 });
    assertDocumentsEquivalent(syncIterableDocument, expected);
    assertDocumentsEquivalent(asyncIterableDocument, expected);
    assertDocumentsEquivalent(readableStreamDocument, expected);
  });

  it("keeps stream write ranges stable across pre-detection buffering and post-detection writes", async () => {
    const fixture = await loadFixture("stream-split-utf8");
    const chunks = splitBytesAt(fixture.bytes, [2, 4, 5]);
    const options = {
      sampleSizeBytes: 4,
      sourceMap: "exact",
    } satisfies DecodeDocumentOptions;
    const expected = decodeDocumentSync(fixture.bytes, options);
    const stream = createDecodingStream(options);

    expect(stream.detection).toBeUndefined();
    expect(stream.write(requiredChunk(chunks, 0))).toEqual([]);
    expect(stream.detection).toBeUndefined();

    const bufferedFlush = stream.write(requiredChunk(chunks, 1));
    expect(stream.detection).toMatchObject({
      encoding: "utf-8",
      source: "utf8-validation",
    });

    expect(stream.write(requiredChunk(chunks, 2))).toEqual([]);

    const finalFlush = stream.write(requiredChunk(chunks, 3));
    const decodedChunks = [...bufferedFlush, ...finalFlush];

    expect(onlyChunk(bufferedFlush)).toMatchObject({
      text: "A€",
      byteRange: { start: 0, end: 4 },
      charRange: { start: 0, end: 2 },
    });
    expect(onlyChunk(bufferedFlush).offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "identity",
      },
      {
        byteRange: { start: 1, end: 4 },
        textRange: { start: 1, end: 2 },
        kind: "encoded",
      },
    ]);
    expect(onlyChunk(finalFlush)).toMatchObject({
      text: "Ж\n",
      byteRange: { start: 4, end: 7 },
      charRange: { start: 2, end: 4 },
    });
    expect(onlyChunk(finalFlush).offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 2 },
        textRange: { start: 0, end: 1 },
        kind: "encoded",
      },
      {
        byteRange: { start: 2, end: 3 },
        textRange: { start: 1, end: 2 },
        kind: "identity",
      },
    ]);
    assertDecodedChunksAreContinuous(decodedChunks, {
      byteLength: fixture.bytes.byteLength,
      textLength: expected.text.length,
    });
    expect(decodedChunks.map((chunk) => chunk.text).join("")).toBe(expected.text);

    assertDocumentsEquivalent(stream.end(), expected);
  });

  it("carries split UTF-16 state and split CRLF into the final document line index", () => {
    const bytes = new Uint8Array([0x16, 0x04, 0x0d, 0x00, 0x0a, 0x00, 0x3d, 0xd8, 0x00, 0xde]);
    const chunks = splitBytesAt(bytes, [1, 5, 8]);
    const options = {
      explicitEncoding: "utf-16le",
      sampleSizeBytes: 1,
      sourceMap: "exact",
    } satisfies DecodeDocumentOptions;
    const expected = decodeDocumentSync(bytes, options);
    const stream = createDecodingStream(options);
    const decodedChunks = chunks.flatMap((chunk) => stream.write(chunk));

    expect(decodedChunks.map((chunk) => chunk.text)).toEqual(["Ж\r", "\n", "😀"]);
    assertDecodedChunksAreContinuous(decodedChunks, {
      byteLength: bytes.byteLength,
      textLength: expected.text.length,
    });

    const document = stream.end();

    assertDocumentsEquivalent(document, expected);
    expect(document.text).toBe("Ж\r\n😀");
    expect(document.lineIndex.lineCount).toBe(2);
    expect(document.lineIndex.lineTextRange(1)).toEqual({ start: 0, end: 1 });
    expect(document.lineIndex.lineTextRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(document.lineIndex.lineByteRange(1)).toEqual({ start: 0, end: 2 });
    expect(document.lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 6 });
    expect(document.lineIndex.lineByteRange(2)).toEqual({ start: 6, end: 10 });
  });

  it("fails or replaces incomplete final stream sequences according to replacement policy", () => {
    const fatalStream = createDecodingStream({
      explicitEncoding: "utf-8",
      sampleSizeBytes: 1,
      sourceMap: "exact",
    });

    expect(onlyChunk(fatalStream.write(new Uint8Array([0x41]))).text).toBe("A");
    expect(fatalStream.write(new Uint8Array([0xe2, 0x82]))).toEqual([]);

    try {
      fatalStream.end();
      throw new Error("Expected incomplete stream finalization to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INCOMPLETE_STREAM_SEQUENCE");
      expect((error as EncodingError).byteRange).toEqual({ start: 1, end: 3 });
    }

    const replaceStream = createDecodingStream({
      explicitEncoding: "utf-8",
      replacementPolicy: "replace",
      replacementCharacter: "?",
      sampleSizeBytes: 1,
      sourceMap: "exact",
    });

    expect(onlyChunk(replaceStream.write(new Uint8Array([0x41]))).text).toBe("A");
    expect(replaceStream.write(new Uint8Array([0xe2, 0x82]))).toEqual([]);

    const document = replaceStream.end();

    expect(document.text).toBe("A?");
    expect(document.offsetMap.segments()).toEqual([
      {
        byteRange: { start: 0, end: 1 },
        textRange: { start: 0, end: 1 },
        kind: "identity",
      },
      {
        byteRange: { start: 1, end: 3 },
        textRange: { start: 1, end: 2 },
        kind: "replacement",
      },
    ]);
    expect(warningCodes(document.warnings)).toEqual(["ENCODING_INCOMPLETE_STREAM_SEQUENCE"]);
    expect(document.warnings[0]).toMatchObject({
      byteRange: { start: 1, end: 3 },
      textRange: { start: 1, end: 2 },
      details: {
        encoding: "utf-8",
        replacementCharacter: "?",
      },
    });
  });

  it("keeps an immutable options snapshot after stream construction", () => {
    const allowedEncodings: RelicMEMEncodingName[] = ["utf-8"];
    const options: MutableDecodeDocumentOptions = {
      profile: "strictUtf8",
      allowedEncodings,
      replacementPolicy: "fatal",
      sampleSizeBytes: 2,
    };
    const stream = createDecodingStream(options);

    options.profile = "legacyCyrillic";
    options.replacementPolicy = "replace";
    allowedEncodings.push("windows-1251");

    expect(() => stream.write(new Uint8Array([0xc3, 0x28]))).toThrow(EncodingError);
  });
});

async function* createAsyncChunks(chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function createReadableStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

function splitBytesAt(bytes: Uint8Array, boundaries: readonly number[]): readonly Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let start = 0;

  for (const boundary of boundaries) {
    chunks.push(bytes.subarray(start, boundary));
    start = boundary;
  }

  chunks.push(bytes.subarray(start));

  return chunks;
}

function requiredChunk(chunks: readonly Uint8Array[], index: number): Uint8Array {
  const chunk = chunks[index];

  if (chunk === undefined) {
    throw new Error(`Expected chunk at index ${String(index)}.`);
  }

  return chunk;
}

function onlyChunk(chunks: readonly DecodedChunk[]): DecodedChunk {
  expect(chunks).toHaveLength(1);

  const chunk = chunks[0];
  if (chunk === undefined) {
    throw new Error("Expected one decoded chunk.");
  }

  return chunk;
}

function assertDecodedChunksAreContinuous(
  chunks: readonly DecodedChunk[],
  expected: {
    readonly byteLength: number;
    readonly textLength: number;
  },
): void {
  let nextByteStart = 0;
  let nextCharStart = 0;

  for (const chunk of chunks) {
    expect(chunk.byteRange.start).toBe(nextByteStart);
    expect(chunk.charRange.start).toBe(nextCharStart);
    expect(chunk.byteRange.end).toBeGreaterThanOrEqual(chunk.byteRange.start);
    expect(chunk.charRange.end).toBeGreaterThanOrEqual(chunk.charRange.start);

    nextByteStart = chunk.byteRange.end;
    nextCharStart = chunk.charRange.end;
  }

  expect(nextByteStart).toBe(expected.byteLength);
  expect(nextCharStart).toBe(expected.textLength);
}

function assertDocumentsEquivalent(actual: DecodedDocument, expected: DecodedDocument): void {
  expect(actual.text).toBe(expected.text);
  expect([...actual.bytes]).toEqual([...expected.bytes]);
  expect([...actual.source.bytes]).toEqual([...expected.source.bytes]);
  expect(actual.detection).toEqual(expected.detection);
  expect(actual.warnings).toEqual(expected.warnings);
  expect(actual.offsetMap.segments()).toEqual(expected.offsetMap.segments());
  expect(actual.lineIndex.lineCount).toBe(expected.lineIndex.lineCount);

  for (let line = 1; line <= expected.lineIndex.lineCount; line += 1) {
    expect(actual.lineIndex.lineTextRange(line)).toEqual(expected.lineIndex.lineTextRange(line));
    expect(actual.lineIndex.lineTextRange(line, true)).toEqual(
      expected.lineIndex.lineTextRange(line, true),
    );
    expect(actual.lineIndex.lineByteRange(line)).toEqual(expected.lineIndex.lineByteRange(line));
    expect(actual.lineIndex.lineByteRange(line, true)).toEqual(
      expected.lineIndex.lineByteRange(line, true),
    );
  }
}

function warningCodes(warnings: readonly EncodingWarning[]): readonly string[] {
  return warnings.map((warning) => warning.code);
}

type MutableDecodeDocumentOptions = {
  -readonly [Key in keyof DecodeDocumentOptions]: DecodeDocumentOptions[Key];
};
