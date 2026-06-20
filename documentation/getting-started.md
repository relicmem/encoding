# Швидкий старт

## Встановлення

Пакет очікує Node.js `>=20.19` і ESM runtime.

```ts
import {
  createDecodingStream,
  decodeDocument,
  decodeDocumentSync,
  detectEncoding,
} from "@rmem/encoding";
```

## Декодування byte input

`decodeDocument` — основний асинхронний API. Він приймає bytes, buffers, sync/async
iterables і `ReadableStream<Uint8Array>`.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "rmem",
  sourceMap: "exact",
});

console.log(decoded.text);
console.log(decoded.detection.encoding);
console.log(decoded.detection.confidence);
```

Для синхронних джерел використовуйте `decodeDocumentSync`.

```ts
const decoded = decodeDocumentSync(new Uint8Array([0xef, 0xbb, 0xbf, 0x23]), {
  profile: "strictUtf8",
});

console.log(decoded.text);
```

## Тільки визначення кодування

`detectEncoding` не декодує весь документ і не будує `OffsetMap`. Його варто
використовувати для routing, logging, diagnostics або тестування detection pipeline.

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

У `webCompat` HTML/WHATWG label `latin1` може нормалізуватися до `windows-1252`; результат
зберігає і вхідний label, і canonical encoding.
Якщо ви зменшуєте `sampleSizeBytes`, перевіряйте `detection.warnings`: sample-limited
byte-derived detection повертає `ENCODING_TRUNCATED_SAMPLE` замість silent full-document
confidence.

## Потокове декодування

`createDecodingStream` потрібен, коли input приходить chunks, а інтегратор хоче отримувати
decoded chunks без втрати byte ranges.

```ts
const stream = createDecodingStream({
  profile: "rmem",
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

`write` може повертати порожній масив до завершення sampling/detection або коли chunk
закінчується всередині multibyte sequence. `end` фіналізує pending state і повертає повний
`DecodedDocument`.

## Byte input проти string input

Передавайте bytes, якщо потрібні original byte ranges, BOM metadata або source-perfect
інтеграція з parser. `string` input уже декодований до виклику бібліотеки; для нього
створюються synthetic UTF-8 bytes, а при exact source map додається warning
`ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`.
