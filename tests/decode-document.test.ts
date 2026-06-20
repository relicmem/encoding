import { describe, expect, expectTypeOf, it } from "vitest";

import { EncodingError, decodeDocument, decodeDocumentSync } from "../src/index.js";
import type {
  DecodeDocumentFunction,
  DecodeDocumentOptions,
  RmemEncodingName,
} from "../src/index.js";

describe("decodeDocument", () => {
  it("exports the asynchronous high-level decode pipeline with the public contract signature", () => {
    expectTypeOf(decodeDocument).toEqualTypeOf<DecodeDocumentFunction>();
  });

  it("decodes async iterable byte chunks through the same core result as sync input", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x0a, 0xd0, 0x96]);
    const syncDocument = decodeDocumentSync(bytes);
    const asyncDocument = await decodeDocument(
      createAsyncChunks(
        bytes.subarray(0, 1),
        bytes.subarray(1, 3),
        bytes.subarray(3, 6),
        bytes.subarray(6),
      ),
    );

    expect(asyncDocument.text).toBe(syncDocument.text);
    expect([...asyncDocument.bytes]).toEqual([...bytes]);
    expect(asyncDocument.detection).toEqual(syncDocument.detection);
    expect(asyncDocument.offsetMap.segments()).toEqual(syncDocument.offsetMap.segments());
    expect(asyncDocument.lineIndex.lineByteRange(2)).toEqual(
      syncDocument.lineIndex.lineByteRange(2),
    );
    expect(asyncDocument.warnings).toEqual(syncDocument.warnings);
    expect(Object.isFrozen(asyncDocument)).toBe(true);
  });

  it("decodes ReadableStream input and preserves split CRLF line behavior", async () => {
    const bytes = new Uint8Array([0x41, 0x0d, 0x0a, 0x42]);
    const document = await decodeDocument(
      createReadableStream(bytes.subarray(0, 2), bytes.subarray(2)),
    );

    expect(document.text).toBe("A\r\nB");
    expect([...document.source.bytes]).toEqual([...bytes]);
    expect(document.lineIndex.lineCount).toBe(2);
    expect(document.lineIndex.lineByteRange(1, true)).toEqual({ start: 0, end: 3 });
    expect(document.lineIndex.lineByteRange(2)).toEqual({ start: 3, end: 4 });
  });

  it("keeps string input on the same synthetic byte path as sync decode", async () => {
    const asyncDocument = await decodeDocument("Привіт", {
      profile: "legacyCyrillic",
      sourceMap: "exact",
    });
    const syncDocument = decodeDocumentSync("Привіт", {
      profile: "legacyCyrillic",
      sourceMap: "exact",
    });

    expect(asyncDocument.text).toBe(syncDocument.text);
    expect(asyncDocument.detection).toEqual(syncDocument.detection);
    expect(asyncDocument.offsetMap.segments()).toEqual(syncDocument.offsetMap.segments());
    expect(asyncDocument.warnings).toEqual(syncDocument.warnings);
  });

  it("keeps an immutable options snapshot while collecting async iterable chunks", async () => {
    const allowedEncodings: RmemEncodingName[] = ["utf-8"];
    const options: MutableDecodeDocumentOptions = {
      profile: "strictUtf8",
      allowedEncodings,
      replacementPolicy: "fatal",
    };

    try {
      await decodeDocument(createMutatingAsyncChunks(options, allowedEncodings), options);
      throw new Error("Expected strict UTF-8 detection to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_INVALID_SEQUENCE");
    }
  });

  it("surfaces fatal decoding states as EncodingError rejections", async () => {
    await expect(
      decodeDocument(createAsyncChunks(new Uint8Array([0xc3, 0x28])), {
        profile: "strictUtf8",
      }),
    ).rejects.toBeInstanceOf(EncodingError);

    try {
      await decodeDocument(new Uint8Array([0x41]), {
        backendPreference: ["text-decoder"],
      });
      throw new Error("Expected source map backend selection failure.");
    } catch (error) {
      expect(error).toBeInstanceOf(EncodingError);
      expect((error as EncodingError).code).toBe("ENCODING_SOURCE_MAP_UNAVAILABLE");
    }
  });

  it("does not hide ReadableStream read failures", async () => {
    const streamError = new Error("stream read failed");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(streamError);
      },
    });

    await expect(decodeDocument(stream)).rejects.toBe(streamError);
  });
});

async function* createAsyncChunks(...chunks: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

function createReadableStream(...chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

async function* createMutatingAsyncChunks(
  options: MutableDecodeDocumentOptions,
  allowedEncodings: RmemEncodingName[],
): AsyncIterable<Uint8Array> {
  await Promise.resolve();

  options.profile = "legacyCyrillic";
  options.replacementPolicy = "replace";
  allowedEncodings.push("windows-1251");

  yield new Uint8Array([0xc3, 0x28]);
}

type MutableDecodeDocumentOptions = {
  -readonly [Key in keyof DecodeDocumentOptions]: DecodeDocumentOptions[Key];
};
