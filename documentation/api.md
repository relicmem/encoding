# API Reference

## `decodeDocument(input, options?)`

Asynchronously decodes an `EncodingInput` into a `DecodedDocument`.

```ts
const decoded = await decodeDocument(input, {
  profile: "relicmem",
  minConfidence: 0.75,
  defaultEncoding: "utf-8",
  allowedEncodings: ["utf-8", "utf-16le", "utf-16be", "windows-1251", "windows-1252", "koi8-r"],
  sourceMap: "exact",
});
```

Fatal states throw `EncodingError`: unsupported encoding, an invalid byte sequence under
`replacementPolicy: "fatal"`, unavailable exact source maps, option conflicts, or an incomplete
stream sequence.

## `decodeDocumentSync(input, options?)`

Synchronous variant for `string`, `Uint8Array`, `ArrayBuffer`, and `Iterable<Uint8Array>`.
Decode asynchronous sources through `decodeDocument`.

```ts
const decoded = decodeDocumentSync(bytes, {
  profile: "strictUtf8",
});
```

## `tryDecodeDocument(input, options?)`

No-throw wrapper for expected fatal encoding states. It is useful for parser diagnostics where an
encoding failure should become a structured diagnostic without `throw`.

```ts
const result = await tryDecodeDocument(bytes, {
  profile: "strictUtf8",
});

if (!result.ok) {
  console.error(result.error.code);
  console.error(result.error.byteRange);
} else {
  console.log(result.value.text);
}
```

Async input read errors are not masked as encoding failures.

## `detectEncoding(input, options?)`

Synchronous detect-only API for `Uint8Array`.

```ts
const detection = detectEncoding(bytes, {
  profile: "legacyCyrillic",
});

console.log(detection.encoding);
console.log(detection.candidates);
console.log(detection.warnings);
```

This API does not build an `OffsetMap` and does not decode the whole document.
If `sampleSizeBytes` is smaller than the full byte input and detection relies on byte validation or
heuristics, the result contains `ENCODING_TRUNCATED_SAMPLE`, and the confidence of the
sample-derived candidate is capped at `0.99`.

## `encodeText(input, encoding, options?)`

Encodes a string fragment into bytes with a canonical or alias encoding label. This is intended for
parser trigger compilation, matchers, and other small fragments; it does not add a BOM.

```ts
const trigger = encodeText("#", "windows-1251");

console.log(trigger.bytes); // Uint8Array [0x23]
console.log(trigger.encoding); // "windows-1251"
console.log(trigger.backend.name); // "native"
```

`encoding` is normalized through the public label registry. Fatal unmappable characters throw
`EncodingError` with `code: "ENCODING_UNMAPPABLE_CHARACTER"` and a `textRange`.

```ts
const result = tryEncodeText("A😀", "windows-1251");

if (!result.ok) {
  console.error(result.error.code);
  console.error(result.error.textRange);
}
```

Use `replacementPolicy: "replace"` to produce bytes and a warning instead of throwing:

```ts
const encoded = encodeText("A😀", "windows-1251", {
  replacementPolicy: "replace",
});

console.log(encoded.bytes); // Uint8Array [0x41, 0x3f]
console.log(encoded.warnings[0].code); // "ENCODING_UNMAPPABLE_CHARACTER_REPLACED"
```

`tryEncodeText(input, encoding, options?)` returns `EncodingResult<EncodedText>` for unsupported
labels, unsupported encode capabilities, and unmappable characters. `canEncodeText` returns a
boolean for the same inputs and options.

## `createDecodingStream(options?)`

Incremental API for stream workflows.

```ts
const stream = createDecodingStream({
  profile: "relicmem",
  sampleSizeBytes: 4096,
  sourceMap: "exact",
});

const chunks = stream.write(firstChunk);
const document = stream.end();
```

`stream.detection` becomes available after detection is fixed. Until then, `write` may buffer input
and return `[]`.
If detection is fixed before the full stream input and later bytes fall outside the sample, the
final `DecodedDocument.detection.warnings` contains `ENCODING_TRUNCATED_SAMPLE`.

## `DecodedDocument`

```ts
decoded.text;
decoded.bytes;
decoded.detection;
decoded.lineIndex;
decoded.offsetMap;
decoded.warnings;
decoded.source;
```

`bytes` and `source.bytes` preserve the original bytes. `text` does not normalize line endings.
`warnings` contains diagnostics from detection, backend selection, decoding, source map building,
and stream finalization in a stable order.
