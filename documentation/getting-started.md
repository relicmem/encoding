# Getting Started

## Installation

The package expects Node.js `>=20.19` and an ESM runtime.

```ts
import {
  createDecodingStream,
  decodeDocument,
  decodeDocumentSync,
  detectEncoding,
  encodeText,
} from "@relicmem/encoding";
```

## Decode Byte Input

`decodeDocument` is the main async API. It accepts bytes, buffers, sync/async iterables, and
`ReadableStream<Uint8Array>`.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});

console.log(decoded.text);
console.log(decoded.detection.encoding);
console.log(decoded.detection.confidence);
```

Use `decodeDocumentSync` for synchronous sources.

```ts
const decoded = decodeDocumentSync(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]), {
  profile: "strictUtf8",
});

console.log(decoded.text);
```

## Detect Only

`detectEncoding` does not decode the full document and does not build an `OffsetMap`. Use it for
routing, logging, diagnostics, or testing the detection pipeline.

```ts
const detection = detectEncoding(bytes, {
  profile: "webCompat",
  metadata: {
    contentType: "text/html; charset=latin1",
  },
});

console.log(detection.encoding);
console.log(detection.label);
console.log(detection.warnings);
```

Under `webCompat`, the HTML/WHATWG label `latin1` can normalize to `windows-1252`; the result
keeps both the input label and the canonical encoding.
If you reduce `sampleSizeBytes`, check `detection.warnings`: sample-limited byte-derived detection
returns `ENCODING_TRUNCATED_SAMPLE` instead of silently reporting full-document confidence.

## Encode Text Fragments

Use `encodeText` when an integration needs byte sequences for short string fragments, such as
parser triggers or byte-level matchers.

```ts
const encoded = encodeText("#", "windows-1251");

console.log(encoded.bytes); // Uint8Array [0x23]
```

By default, unmappable characters are fatal and produce `EncodingError`. With
`replacementPolicy: "replace"`, the API returns replacement bytes and an
`ENCODING_UNMAPPABLE_CHARACTER_REPLACED` warning.

## Stream Decoding

Use `createDecodingStream` when input arrives in chunks and the integrator wants decoded chunks
without losing byte ranges.

```ts
const stream = createDecodingStream({
  profile: "relicmem",
  sourceMap: "exact",
});

for await (const chunk of chunks) {
  for (const decodedChunk of stream.write(chunk)) {
    console.log(decodedChunk.text, decodedChunk.byteRange);
  }
}

const document = stream.end();
console.log(document.text);
```

`write` can return an empty array until sampling/detection completes or when a chunk ends inside a
multibyte sequence. `end` finalizes pending state and returns the complete `DecodedDocument`.

## Byte Input vs. String Input

Pass bytes when you need original byte ranges, BOM metadata, or source-perfect parser integration.
`string` input has already been decoded before the library is called; the library creates synthetic
UTF-8 bytes for it, and exact source maps add the warning
`ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`.
