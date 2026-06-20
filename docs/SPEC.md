# Технічне завдання: `@rmem/encoding`

## 1. Призначення пакета

Пакет `@rmem/encoding` є byte-to-text intake layer для `rmem`-документів. Його відповідальність - прийняти байтовий вхід, контрольовано визначити кодування, декодувати текст, зберегти зв'язок між raw bytes і decoded text та повернути структуровані warnings для вищих шарів.

Бібліотека не є Markdown parser. Вона має прибрати encoding hell з `@rmem/md-parser`, щоб parser працював з уже декодованим документом, byte ranges, char ranges, line index, confidence і warnings, не реалізуючи евристики кодувань у parser core.

Ключова відмінність від готових бібліотек:

```text
готові пакети:
  "ось тобі encoding" або "ось тобі decoded string"

@rmem/encoding:
  "ось тобі decoded document, byte ranges, char ranges, confidence,
   warnings, BOM info, decoder backend, source map і normalized labels"
```

## 2. Цілі

- Контрольовано визначати encoding для byte input.
- Декодувати buffer, stream і, за потреби, already-decoded string input.
- Зберігати raw bytes для source-perfect workflows.
- Будувати source map між byte offsets і JavaScript text offsets.
- Будувати line index без нормалізації line endings.
- Повертати confidence, candidates, BOM info, normalized labels, backend info і warnings.
- Працювати stream-safe: не ламати multibyte sequences на межах chunks.
- Давати `@rmem/md-parser` стабільний контракт без залежності від конкретного decoder/detector provider.

## 3. Non-goals

- Повний Markdown parsing.
- Автоматичне "лікування" пошкоджених файлів.
- Агресивне auto-detect everything без профілю.
- Гарантоване визначення мови документа.
- Нормалізація Markdown, line endings або Unicode normalization form.
- Вбудована підтримка кожного legacy encoding у першій версії.

## 4. Базова архітектура

Рекомендована структура пакета:

```text
@rmem/encoding
  src/
    detector/
      BomDetector.ts
      Utf8Validator.ts
      Utf16Detector.ts
      ChardetDetector.ts
      CompositeEncodingDetector.ts

    decoder/
      TextDecoderBackend.ts
      IconvLiteBackend.ts
      ExodusBytesBackend.ts
      DecoderRegistry.ts

    source/
      SourceBuffer.ts
      LineIndex.ts
      OffsetMap.ts
      DecodedDocument.ts

    stream/
      DecodingStream.ts
      DetectionSampler.ts

    profile/
      RmemEncodingProfile.ts
      StrictUtf8Profile.ts
      LegacyCyrillicProfile.ts
      WebCompatProfile.ts
```

Внутрішній pipeline:

```text
input
  -> source buffer / stream sampler
  -> label normalization
  -> profile resolution
  -> detection candidates
  -> detection decision
  -> controlled decoder backend
  -> offset map builder
  -> line index builder
  -> DecodedDocument
```

## 5. Підтримувані canonical encodings v1

```ts
export type RmemEncodingName =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "windows-1251"
  | "windows-1252"
  | "iso-8859-1"
  | "iso-8859-5"
  | "koi8-r"
  | "cp866";
```

Canonical name завжди має бути lowercase і stable. Labels на вході можуть бути різними (`utf8`, `UTF-8`, `win1251`, `cp-866`, `latin1`), але публічний результат має повертати normalized canonical encoding.

Для `webCompat` профілю label normalization має враховувати WHATWG behavior. Зокрема HTML label `iso-8859-1` у web-compatible контексті може нормалізуватися до `windows-1252`, якщо опція профілю не вимагає strict ISO semantics. Результат має явно показувати і original label, і canonical encoding, щоб інтегратор бачив це рішення.

## 6. Публічний API

### 6.1. High-level decode

```ts
export type EncodingInput =
  | string
  | Uint8Array
  | ArrayBuffer
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>;

export type RmemEncodingProfileName =
  | "strictUtf8"
  | "rmem"
  | "legacyCyrillic"
  | "webCompat";

export interface DecodeDocumentOptions {
  readonly profile?: RmemEncodingProfileName | EncodingProfile;
  readonly explicitEncoding?: string;
  readonly defaultEncoding?: RmemEncodingName;
  readonly allowedEncodings?: readonly RmemEncodingName[];
  readonly minConfidence?: number;
  readonly metadata?: EncodingMetadata;
  readonly stripBom?: boolean;
  readonly sourceMap?: "exact" | "line" | "none";
  readonly replacementPolicy?: "fatal" | "replace";
  readonly replacementCharacter?: string;
  readonly backendPreference?: readonly DecoderBackendName[];
  readonly sampleSizeBytes?: number;
}

export function decodeDocument(
  input: EncodingInput,
  options?: DecodeDocumentOptions,
): Promise<DecodedDocument>;

export function decodeDocumentSync(
  input: string | Uint8Array | ArrayBuffer | Iterable<Uint8Array>,
  options?: DecodeDocumentOptions,
): DecodedDocument;

export function tryDecodeDocument(
  input: EncodingInput,
  options?: DecodeDocumentOptions,
): Promise<EncodingResult<DecodedDocument>>;
```

`decodeDocument` і `decodeDocumentSync` мають кидати `EncodingError` тільки для fatal станів: unsupported encoding, invalid byte sequence при `replacementPolicy: "fatal"`, неможливість побудувати required source map, конфлікт опцій, stream finalization з неповною byte sequence.

`tryDecodeDocument` має повертати structured result без throw, щоб `@rmem/md-parser` міг перетворити encoding failures у parser diagnostics.

### 6.2. Detection-only API

```ts
export interface DetectEncodingOptions {
  readonly profile?: RmemEncodingProfileName | EncodingProfile;
  readonly explicitEncoding?: string;
  readonly defaultEncoding?: RmemEncodingName;
  readonly allowedEncodings?: readonly RmemEncodingName[];
  readonly minConfidence?: number;
  readonly metadata?: EncodingMetadata;
  readonly sampleSizeBytes?: number;
}

export function detectEncoding(
  input: Uint8Array,
  options?: DetectEncodingOptions,
): EncodingDetectionResult;
```

Detection-only API не має декодувати весь документ і не має будувати `OffsetMap`. Він потрібен для швидкого routing, logging, diagnostics і тестування detector pipeline.

### 6.3. Stream API

```ts
export interface DecodedChunk {
  readonly text: string;
  readonly byteRange: SourceByteRange;
  readonly charRange: TextRange;
  readonly offsetMap: OffsetMap;
  readonly warnings: readonly EncodingWarning[];
}

export interface DecodingStream {
  readonly detection: EncodingDetectionResult | undefined;
  write(chunk: Uint8Array): readonly DecodedChunk[];
  end(): DecodedDocument;
}

export function createDecodingStream(options?: DecodeDocumentOptions): DecodingStream;
```

`write` може повертати порожній масив до завершення sampling/detection. Після того як detection зафіксована, stream має декодувати chunks інкрементально і не втрачати byte ranges. `end` зобов'язаний перевірити pending decoder state і повернути повний `DecodedDocument`.

## 7. Основні типи результату

```ts
export interface DecodedDocument {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly detection: EncodingDetectionResult;
  readonly lineIndex: LineIndex;
  readonly offsetMap: OffsetMap;
  readonly warnings: readonly EncodingWarning[];
  readonly source: SourceBuffer;
}

export interface EncodingDetectionResult {
  readonly encoding: RmemEncodingName;
  readonly confidence: number;
  readonly source: EncodingDetectionSource;
  readonly bomLength: number;
  readonly candidates: readonly EncodingCandidate[];
  readonly warnings: readonly EncodingWarning[];
  readonly label: NormalizedEncodingLabel;
  readonly backend: DecoderBackendInfo;
}

export type EncodingDetectionSource =
  | "explicit"
  | "bom"
  | "utf8-validation"
  | "utf16-heuristic"
  | "metadata"
  | "heuristic"
  | "fallback";

export interface EncodingCandidate {
  readonly encoding: RmemEncodingName;
  readonly confidence: number;
  readonly source: EncodingDetectionSource;
  readonly reason: string;
  readonly bomLength: number;
}

export interface NormalizedEncodingLabel {
  readonly inputLabel?: string;
  readonly canonical: RmemEncodingName;
  readonly aliases: readonly string[];
  readonly source: "explicit" | "metadata" | "bom" | "profile" | "default";
}
```

`DecodedDocument.warnings` має бути об'єднанням warnings з detection, decoder backend, source map builder і stream finalization. Масив має бути immutable і stable за порядком виникнення.

## 8. Source model

### 8.1. Offset semantics

Усі ranges використовують half-open інтервали `[start, end)`.

```ts
export type ByteOffset = number;
export type CharacterOffset = number;

export interface SourceByteRange {
  readonly start: ByteOffset;
  readonly end: ByteOffset;
}

export interface TextRange {
  readonly start: CharacterOffset;
  readonly end: CharacterOffset;
}
```

`CharacterOffset` у v1 означає JavaScript UTF-16 code unit offset, сумісний з `string.length`, `slice` і поточною source model у `@rmem/md-parser`. Для code point navigation бібліотека може надати додаткові helpers, але базовий контракт не має змішувати code units і code points.

### 8.2. OffsetMap

```ts
export interface OffsetMap {
  byteRangeForTextRange(range: TextRange): SourceByteRange;
  textRangeForByteRange(range: SourceByteRange): TextRange;
  byteOffsetForTextOffset(offset: CharacterOffset, bias?: OffsetBias): ByteOffset;
  textOffsetForByteOffset(offset: ByteOffset, bias?: OffsetBias): CharacterOffset;
  segments(): readonly OffsetMapSegment[];
}

export type OffsetBias = "start" | "end" | "nearest";

export interface OffsetMapSegment {
  readonly byteRange: SourceByteRange;
  readonly textRange: TextRange;
  readonly kind: "identity" | "encoded" | "bom" | "replacement" | "synthetic";
}
```

`OffsetMap` має бути segment-based, а не per-character array за замовчуванням. Exact map required для профілю `rmem` і для інтеграції з `@rmem/md-parser`.

Для BOM при `stripBom: true` має створюватися segment `kind: "bom"` з ненульовим `byteRange` і collapsed `textRange`. Текст документа починається після BOM, але raw bytes залишаються доступними.

Для replacement decoding segment `kind: "replacement"` має зберігати original invalid byte range і text range replacement character. При `replacementPolicy: "fatal"` такі segments не створюються, бо decoding має завершитися fatal error.

### 8.3. LineIndex

```ts
export interface LineIndex {
  readonly lineCount: number;
  lineStartOffset(line: number): CharacterOffset;
  lineEndOffset(line: number): CharacterOffset;
  lineTextRange(line: number, includeLineEnding?: boolean): TextRange;
  lineByteRange(line: number, includeLineEnding?: boolean): SourceByteRange;
  positionAtTextOffset(offset: CharacterOffset): SourcePosition;
  positionAtByteOffset(offset: ByteOffset, bias?: OffsetBias): SourcePosition;
}

export interface SourcePosition {
  readonly byteOffset: ByteOffset;
  readonly characterOffset: CharacterOffset;
  readonly line: number;
  readonly column: number;
}
```

Line numbering і column numbering починаються з `1`. Line endings не нормалізуються. `\r\n` рахується як один line break, навіть якщо sequence розділена між stream chunks. Окремі `\r` і `\n` також мають коректно відкривати новий рядок.

## 9. Detection pipeline

Detector має бути deterministic. Якщо профіль, allowed encodings і input однакові, результат і порядок candidates мають бути однаковими.

Порядок прийняття рішення:

1. Нормалізувати options і profile.
2. Нормалізувати explicit label, якщо він заданий.
3. Зібрати sample для stream input без втрати original chunk boundaries.
4. Перевірити BOM.
5. Перевірити metadata labels, якщо профіль це дозволяє.
6. Провалідувати UTF-8.
7. Запустити UTF-16 heuristic, якщо профіль це дозволяє.
8. Запустити legacy heuristics тільки для allowed candidates профілю.
9. Застосувати fallback default encoding.
10. Перевірити `minConfidence` і сформувати warnings або fatal result за політикою профілю.

Якщо byte-derived detection (`utf8-validation`, `utf16-heuristic`, `heuristic` або fallback
після відсутності сильнішого сигналу) приймається за bounded sample, а не за повним input,
результат має містити warning `ENCODING_TRUNCATED_SAMPLE`. Для таких sample-limited кандидатів
confidence не може залишатися `1`: значення cap-иться на `0.99`, щоб не видавати перевірку sample
за повну валідацію документа. Explicit encoding, BOM і metadata не cap-ляться цим правилом, бо
їхній сигнал не залежить від повного проходу по байтах документа.

Priority rules:

- Explicit encoding має найвищий пріоритет.
- Якщо explicit encoding конфліктує з BOM, explicit все одно перемагає, але має бути warning або fatal error залежно від профілю.
- BOM перемагає metadata і heuristic detection, якщо explicit encoding не заданий.
- UTF-8 validation має бути сильнішим сигналом за legacy heuristics для `rmem` і `strictUtf8`.
- Legacy encodings у `rmem` профілі дозволені тільки якщо UTF-8 invalid або explicit/metadata вказує legacy encoding.
- Fallback має створювати warning, якщо confidence нижче `minConfidence`.

## 10. Profiles

Profiles є не зручним alias, а політикою detection/decoding. Універсальна auto-detect everything політика не допускається як default.

### 10.1. `strictUtf8`

Для нових `rmem`-файлів.

- Приймає UTF-8.
- Приймає UTF-8 BOM.
- UTF-16 приймається тільки з BOM і тільки якщо `allowBomUtf16` увімкнено в profile options.
- Legacy heuristics вимкнені.
- Invalid UTF-8 є fatal за замовчуванням.
- Low confidence не має silently fallback до legacy encoding.

### 10.2. `rmem`

Default для CLI/import.

- Explicit encoding wins.
- BOM wins, якщо explicit encoding не заданий.
- UTF-8 validation виконується до legacy heuristics.
- UTF-16 detection дозволений.
- `windows-1251` і `windows-1252` дозволені тільки якщо UTF-8 invalid або є explicit/metadata signal.
- Low confidence створює warning.
- Default `minConfidence`: `0.75`.

### 10.3. `legacyCyrillic`

Для імпорту старих українських і російських документів.

Focus candidates:

- `utf-8`
- `windows-1251`
- `koi8-r`
- `cp866`
- `iso-8859-5`

Профіль має мати сильніше Cyrillic scoring, але не має перекривати explicit encoding або BOM. Якщо кілька legacy candidates мають близький score, результат має містити warning про ambiguous detection.

### 10.4. `webCompat`

Для HTML/Markdown з web-джерел.

- Підтримує WHATWG labels.
- Може використовувати `TextDecoder` або `@exodus/bytes` backend.
- HTML `<meta charset>` і HTTP `content-type` metadata можуть брати участь у detection.
- BOM має пріоритет над HTML metadata.
- WHATWG label remapping має бути видимим у `NormalizedEncodingLabel`.

## 11. Decoder backends

```ts
export type DecoderBackendName = "text-decoder" | "iconv-lite" | "exodus-bytes" | "native";

export interface DecoderBackendInfo {
  readonly name: DecoderBackendName;
  readonly version?: string;
  readonly exactSourceMap: boolean;
}

export interface DecoderBackend {
  readonly info: DecoderBackendInfo;
  canDecode(encoding: RmemEncodingName): boolean;
  canEncode(encoding: RmemEncodingName): boolean;
  decode(input: Uint8Array, options: BackendDecodeOptions): BackendDecodeResult;
  encode(input: string, encoding: RmemEncodingName, options?: EncodeOptions): EncodeResult;
}
```

Backend не може бути просто функцією `Uint8Array -> string`, якщо profile вимагає exact source map. Він має або повертати mapping segments, або працювати разом із deterministic `OffsetMapBuilder`, який вміє валідувати byte sequences для цього encoding.

Якщо backend не підтримує exact source map, його можна використовувати тільки при `sourceMap: "none"` або в режимі, де інтегратор явно погодився втратити byte/text mapping. Профіль `rmem` не має приймати такий backend для parser integration.

Encode support у backend layer має бути контрольованим так само, як decoding: `canEncode` чесно відображає підтримані canonical encodings, `replacementPolicy: "fatal"` кидає `ENCODING_UNMAPPABLE_CHARACTER` з `textRange`, а `replacementPolicy: "replace"` повертає bytes із warning `ENCODING_UNMAPPABLE_CHARACTER_REPLACED`. Default replacement character для encode має бути ASCII `?`, щоб він був representable у всіх v1 single-byte encodings.

## 12. Controlled decoding

Default decoding policy для `rmem` і `strictUtf8`: `replacementPolicy: "fatal"`.

При fatal policy:

- invalid byte sequence завершує decoding error;
- error містить byte range проблемної sequence;
- partially decoded document не повертається як successful result.

При replace policy:

- invalid sequence замінюється `replacementCharacter`, default `"\uFFFD"`;
- кожна заміна створює warning;
- `OffsetMap` має містити replacement segment;
- confidence має бути знижений.

BOM behavior:

- `stripBom: true` за замовчуванням.
- Raw bytes завжди зберігають BOM.
- `detection.bomLength` показує довжину BOM у байтах.
- Якщо BOM збережений у text через `stripBom: false`, `OffsetMap` має мапити BOM bytes на відповідний text range.

## 13. Warnings і errors

Усі user-facing messages, які генерує код бібліотеки, мають бути англійською мовою.

```ts
export type EncodingWarningSeverity = "info" | "warning";

export interface EncodingWarning {
  readonly code: string;
  readonly severity: EncodingWarningSeverity;
  readonly message: string;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface EncodingError extends Error {
  readonly code: string;
  readonly byteRange?: SourceByteRange;
  readonly textRange?: TextRange;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly warnings: readonly EncodingWarning[];
}
```

Базові warning/error codes:

- `ENCODING_LOW_CONFIDENCE`
- `ENCODING_FALLBACK_USED`
- `ENCODING_BOM_CONFLICT`
- `ENCODING_METADATA_CONFLICT`
- `ENCODING_UNSUPPORTED_LABEL`
- `ENCODING_UNSUPPORTED_ENCODING`
- `ENCODING_INVALID_SEQUENCE`
- `ENCODING_INVALID_SEQUENCE_REPLACED`
- `ENCODING_UNMAPPABLE_CHARACTER`
- `ENCODING_UNMAPPABLE_CHARACTER_REPLACED`
- `ENCODING_AMBIGUOUS_CANDIDATES`
- `ENCODING_BACKEND_SUBSTITUTION`
- `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`
- `ENCODING_INCOMPLETE_STREAM_SEQUENCE`
- `ENCODING_SOURCE_MAP_UNAVAILABLE`
- `ENCODING_TRUNCATED_SAMPLE`

`@rmem/md-parser` має конвертувати fatal `EncodingError` у parser diagnostic phase `encoding`, а warnings - у warning diagnostics без втрати `byteRange` і `details`.

## 14. Metadata

```ts
export interface EncodingMetadata {
  readonly declaredEncoding?: string;
  readonly contentType?: string;
  readonly htmlHeadSample?: string;
  readonly sourceName?: string;
}
```

Metadata не має мовчки перебивати BOM. Metadata може перебити heuristic detection у `webCompat` профілі, але має створити warning, якщо декодування з metadata encoding дає invalid sequence або конфліктує з BOM.

## 15. String input

`string` input є already-decoded input. Він існує для API symmetry і тестів, але не є source-perfect byte intake.

Правила:

- `text` дорівнює input string.
- `bytes` є UTF-8 re-encode тексту, якщо `preserveBytes` не вимкнено внутрішньою оптимізацією.
- `detection.source` має бути `"explicit"`.
- `detection.encoding` має бути `explicitEncoding` або `defaultEncoding`, default `"utf-8"`.
- Має бути warning `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`, якщо інтегратор запитав exact source map.

Для `@rmem/md-parser` source-perfect режим має передавати byte input, не string input.

## 16. Encoding profiles для parser modes

`@rmem/md-parser` очікує два інтеграційні режими:

- Native byte-safe mode: parser може працювати напряму з byte ranges для UTF-8 і ASCII-compatible single-byte encodings.
- Transcode compatibility mode: parser працює з decoded text, але всі source ranges мають мапитись назад у original bytes через `OffsetMap`.

`@rmem/encoding` має expose metadata, достатню для вибору режиму:

```ts
export interface EncodingProfile {
  readonly name: string;
  readonly allowedEncodings: readonly RmemEncodingName[];
  readonly asciiCompatibleEncodings: readonly RmemEncodingName[];
  readonly nativeByteSafeEncodings: readonly RmemEncodingName[];
  readonly defaultEncoding: RmemEncodingName;
  readonly minConfidence: number;
  readonly legacyHeuristics: boolean;
  readonly utf16Heuristics: boolean;
  readonly metadataSniffing: boolean;
}
```

Для v1 native byte-safe encodings:

- `utf-8`
- ASCII-compatible single-byte encodings: `windows-1251`, `windows-1252`, `iso-8859-1`, `iso-8859-5`, `koi8-r`, `cp866`

`utf-16le` і `utf-16be` мають іти через transcode compatibility mode.

Parser integration contract: `@rmem/md-parser` має приймати public `DecodedDocument`
як runtime-документ і обирати режим за `decoded.detection.encoding` та public
`EncodingProfile.nativeByteSafeEncodings`. Якщо вибране кодування входить у
`nativeByteSafeEncodings`, parser може використовувати native byte-safe mode;
інакше він має переходити на transcode compatibility mode і мапити ranges через
`DecodedDocument.offsetMap`. Parser не має імпортувати internal detector,
decoder, source model або profile policy classes.

## 17. Приклад інтеграції

```ts
import { decodeDocument } from "@rmem/encoding";
import { createParser } from "@rmem/md-parser";

const decoded = await decodeDocument(input, {
  profile: "rmem",
  minConfidence: 0.75,
  defaultEncoding: "utf-8",
  allowedEncodings: [
    "utf-8",
    "utf-16le",
    "utf-16be",
    "windows-1251",
    "windows-1252",
    "koi8-r",
  ],
});

const parser = createParser();
const result = await parser.parse({
  kind: "decoded-document",
  value: decoded,
});
```

`@rmem/md-parser` має залежати від public contract `DecodedDocument`, а не від internal detector або decoder classes.

## 18. Критерії приймання v1

- `decodeDocument` повертає `DecodedDocument` з text, bytes, detection, lineIndex, offsetMap і warnings.
- UTF-8 без BOM визначається через validation з confidence `1`, якщо повний byte input валідний і профіль не має сильнішого explicit/BOM signal; для truncated sample detection confidence cap-иться і повертається `ENCODING_TRUNCATED_SAMPLE`.
- UTF-8 BOM, UTF-16LE BOM і UTF-16BE BOM визначаються до heuristic detection.
- Invalid UTF-8 у `strictUtf8` дає fatal error.
- `rmem` профіль не вибирає legacy encoding, якщо UTF-8 валідний.
- `legacyCyrillic` відрізняє `windows-1251`, `koi8-r`, `cp866` і `iso-8859-5` на контрольних fixtures з українським/кириличним текстом або повертає ambiguous warning.
- Stream decoding коректно обробляє UTF-8 і UTF-16 sequences, розділені між chunks.
- `OffsetMap` мапить text ranges назад у byte ranges для UTF-8, UTF-16LE/BE і single-byte legacy encodings.
- `LineIndex` стабільно працює для LF, CRLF, CR і split CRLF між chunks.
- Decoder backend, який не може забезпечити exact source map, не використовується у `rmem` profile без explicit opt-in.
- Усі runtime messages, warnings і errors англійською мовою.

## 19. Мінімальні fixtures

- `utf8-no-bom.md`
- `utf8-bom.md`
- `utf8-invalid-sequence.md`
- `utf16le-bom.md`
- `utf16be-bom.md`
- `windows1251-uk.md`
- `windows1252-latin.md`
- `koi8r-cyrillic.md`
- `cp866-cyrillic.md`
- `iso8859-5-cyrillic.md`
- `ambiguous-ascii.md`
- `html-meta-windows1251.md`
- `stream-split-utf8.md`
- `stream-split-crlf.md`

Кожен fixture має перевіряти не тільки decoded text, а й detection source, confidence, BOM length, warnings, line index і ключові offset map ranges.

