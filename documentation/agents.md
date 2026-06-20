# Довідник для агентів `@relicmem/encoding`

Це монолітний довідник для агентів. Для користувацької документації дивись структуровані
файли в цьому ж каталозі.

## Призначення

`@relicmem/encoding` — byte-to-text intake layer для `RelicMEM` documents. Бібліотека не парсить
Markdown. Вона визначає encoding, декодує bytes, зберігає raw source, будує `OffsetMap` і
`LineIndex`, повертає detection metadata, backend metadata, warnings і fatal `EncodingError`.

## Основні public imports

```ts
import {
  BUILT_IN_ENCODING_PROFILES,
  createDecodingStream,
  decodeDocument,
  decodeDocumentSync,
  detectEncoding,
  tryDecodeDocument,
} from "@relicmem/encoding";
```

Публічні приклади мають імпортувати з package root. Не документуй internal modules як contract
для інтеграторів.

## Decode API верхнього рівня

```ts
const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});
```

`decodeDocument` приймає `string`, `Uint8Array`, `ArrayBuffer`, `Iterable<Uint8Array>`,
`AsyncIterable<Uint8Array>` і `ReadableStream<Uint8Array>`. `decodeDocumentSync` приймає тільки
sync input. Fatal encoding states кидають `EncodingError`.

## Detect-only API

```ts
const detection = detectEncoding(bytes, {
  profile: "webCompat",
  metadata: {
    contentType: "text/html; charset=latin1",
  },
});
```

Detect-only не декодує весь документ і не будує source map. Використовуй його для routing,
logging, diagnostics і tests.

## Stream API

```ts
const stream = createDecodingStream({
  profile: "relicmem",
  sourceMap: "exact",
});

const chunks = stream.write(chunk);
const document = stream.end();
```

`write` може повернути `[]` до завершення sampling/detection або коли decoder тримає pending
multibyte sequence. `end` фіналізує stream і повертає повний `DecodedDocument`, або кидає
`ENCODING_INCOMPLETE_STREAM_SEQUENCE` при fatal policy.

## Профілі

- `relicmem` — default для CLI/import і parser integration; exact source map, UTF-8 validation
  сильніший за legacy heuristics, default `minConfidence: 0.75`.
- `strictUtf8` — для нових документів; legacy heuristics вимкнені, invalid UTF-8 fatal.
- `legacyCyrillic` — імпорт старих Cyrillic documents; focus `windows-1251`, `koi8-r`,
  `cp866`, `iso-8859-5`; ambiguous close scores дають warning.
- `webCompat` — web/HTML джерела; metadata sniffing і WHATWG label behavior, наприклад
  `latin1` може стати `windows-1252`.

## Source model

`DecodedDocument`:

```ts
decoded.text;
decoded.bytes;
decoded.source;
decoded.detection;
decoded.offsetMap;
decoded.lineIndex;
decoded.warnings;
```

Ranges half-open: `[start, end)`. `CharacterOffset` — JavaScript UTF-16 code unit offset.
`LineIndex` не нормалізує line endings. BOM при `stripBom: true` лишається в raw bytes і
представлений collapsed `bom` segment.

## Caveat для string input

String input уже декодований. Для нього бібліотека створює synthetic UTF-8 bytes. Якщо
запитано exact source map, очікуй warning `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`. Для
source-perfect parser workflows завжди передавай byte input.

## Інтеграція parser

Parser має приймати public `DecodedDocument`:

```ts
const decoded = await decodeDocument(input, {
  profile: "relicmem",
  sourceMap: "exact",
});

const profile = BUILT_IN_ENCODING_PROFILES.relicmem;
const mode = profile.nativeByteSafeEncodings.includes(decoded.detection.encoding)
  ? "native-byte-safe"
  : "transcode-compatibility";
```

Native byte-safe encodings у v1: `utf-8`, `windows-1251`, `windows-1252`, `iso-8859-1`,
`iso-8859-5`, `koi8-r`, `cp866`. UTF-16 variants мають іти через transcode compatibility з
range mapping через `DecodedDocument.offsetMap`.

## Diagnostics

Runtime diagnostic messages мають бути англійською мовою. Документація та кодові коментарі —
українською.

Warnings/errors не можна перетворювати на plain strings у public integration. Зберігай
`code`, `byteRange`, `textRange`, `details` і `warnings`.

## Перевірка документації

Public examples мають бути покриті `tests/public-docs-examples.test.ts`. Після зміни examples
запускай `npm run typecheck` і релевантні tests, а перед завершенням задачі — `npm run check`.
