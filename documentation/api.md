# Довідник API

## `decodeDocument(input, options?)`

Асинхронно декодує `EncodingInput` у `DecodedDocument`.

```ts
const decoded = await decodeDocument(input, {
  profile: "rmem",
  minConfidence: 0.75,
  defaultEncoding: "utf-8",
  allowedEncodings: ["utf-8", "utf-16le", "utf-16be", "windows-1251", "windows-1252", "koi8-r"],
  sourceMap: "exact",
});
```

Fatal states кидають `EncodingError`: unsupported encoding, invalid byte sequence при
`replacementPolicy: "fatal"`, неможливість exact source map, конфлікт опцій або incomplete
stream sequence.

## `decodeDocumentSync(input, options?)`

Синхронний варіант для `string`, `Uint8Array`, `ArrayBuffer` і `Iterable<Uint8Array>`.
Асинхронні джерела потрібно декодувати через `decodeDocument`.

```ts
const decoded = decodeDocumentSync(bytes, {
  profile: "strictUtf8",
});
```

## `tryDecodeDocument(input, options?)`

No-throw wrapper для очікуваних fatal encoding states. Він корисний для parser diagnostics,
де encoding failure треба перетворити на structured diagnostic без `throw`.

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

Помилки читання async input не маскуються як encoding failures.

## `detectEncoding(input, options?)`

Синхронний detect-only API для `Uint8Array`.

```ts
const detection = detectEncoding(bytes, {
  profile: "legacyCyrillic",
});

console.log(detection.encoding);
console.log(detection.candidates);
console.log(detection.warnings);
```

Цей API не будує `OffsetMap` і не декодує весь документ.

## `createDecodingStream(options?)`

Інкрементальний API для stream workflows.

```ts
const stream = createDecodingStream({
  profile: "rmem",
  sampleSizeBytes: 4096,
  sourceMap: "exact",
});

const chunks = stream.write(firstChunk);
const document = stream.end();
```

`stream.detection` стає доступним після фіксації detection. До цього `write` може буферизувати
input і повертати `[]`.

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

`bytes` і `source.bytes` зберігають original bytes. `text` не нормалізує line endings.
`warnings` містить diagnostics із detection, backend selection, decoding, source map builder і
stream finalization у стабільному порядку.
