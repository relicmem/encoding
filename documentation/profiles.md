# Профілі кодування

Профілі — це політики detection/decoding, а не короткі aliases. Default profile — `rmem`.

## `rmem`

Default для CLI/import і майбутньої інтеграції з `@rmem/md-parser`.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "rmem",
  sourceMap: "exact",
});
```

Властивості:

- explicit encoding має найвищий пріоритет;
- BOM перемагає metadata/heuristics, якщо explicit encoding не заданий;
- UTF-8 validation сильніший сигнал за legacy heuristics;
- `windows-1251` і `windows-1252` не вибираються для valid UTF-8 без explicit/metadata signal;
- default `minConfidence` — `0.75`;
- exact source map required за замовчуванням.

## `strictUtf8`

Для нових документів, де legacy fallback є помилкою.

```ts
const decoded = decodeDocumentSync(bytes, {
  profile: "strictUtf8",
});
```

Invalid UTF-8 є fatal за замовчуванням. Legacy heuristics вимкнені.

## `legacyCyrillic`

Для імпорту старих українських і російських документів.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "legacyCyrillic",
  allowedEncodings: ["utf-8", "windows-1251", "koi8-r", "cp866", "iso-8859-5"],
});
```

Профіль фокусується на `windows-1251`, `koi8-r`, `cp866` і `iso-8859-5`, але не перебиває
explicit encoding або BOM. Якщо кілька legacy candidates близькі за score, результат містить
warning `ENCODING_AMBIGUOUS_CANDIDATES`.

## `webCompat`

Для HTML/Markdown із web-джерел.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "webCompat",
  metadata: {
    contentType: "text/html; charset=latin1",
  },
  sourceMap: "none",
});
```

Профіль підтримує metadata sniffing і WHATWG label behavior. Наприклад, `latin1` або
`iso-8859-1` у web-compatible контексті може нормалізуватися до `windows-1252`. Якщо exact
source map не потрібен, `sourceMap: "none"` дозволяє використовувати не-exact backends без
source-map fatal error.

## Custom profile

Custom profile має явно описувати allowed encodings, native byte-safe encodings і policies.
Використовуйте його тільки коли built-in profiles не відповідають продуктному режиму.

```ts
const customProfile = {
  name: "productImport",
  allowedEncodings: ["utf-8", "windows-1251"],
  asciiCompatibleEncodings: ["utf-8", "windows-1251"],
  nativeByteSafeEncodings: ["utf-8", "windows-1251"],
  defaultEncoding: "utf-8",
  minConfidence: 0.8,
  legacyHeuristics: true,
  utf16Heuristics: false,
  metadataSniffing: false,
} as const;

const decoded = decodeDocumentSync(bytes, {
  profile: customProfile,
});
```
