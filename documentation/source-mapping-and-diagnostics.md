# Source Mapping і Diagnostics

## Offset semantics

Усі ranges є half-open інтервалами `[start, end)`.

```ts
const byteRange = decoded.offsetMap.byteRangeForTextRange({ start: 0, end: 1 });
const textRange = decoded.offsetMap.textRangeForByteRange({ start: 3, end: 4 });
```

`CharacterOffset` означає JavaScript UTF-16 code unit offset, сумісний із `string.length` і
`slice`.

## `OffsetMap`

`OffsetMap` segment-based. Він не є per-character масивом за замовчуванням.

```ts
for (const segment of decoded.offsetMap.segments()) {
  console.log(segment.kind, segment.byteRange, segment.textRange);
}
```

Типові segment kinds:

- `identity` — byte offsets і text offsets рухаються 1:1;
- `encoded` — один символ займає кілька bytes або mapping не 1:1;
- `bom` — BOM bytes, які можуть мати collapsed text range при `stripBom: true`;
- `replacement` — invalid bytes, замінені `replacementCharacter`;
- `synthetic` — bytes, створені для already-decoded string input.

## `LineIndex`

`LineIndex` не нормалізує line endings. `\r\n` рахується як один line break, окремі `\r` і
`\n` також підтримуються.

```ts
const firstLineText = decoded.lineIndex.lineTextRange(1);
const firstLineBytes = decoded.lineIndex.lineByteRange(1, true);
const position = decoded.lineIndex.positionAtByteOffset(10, "nearest");
```

Line і column numbering починаються з `1`.

## Warnings

Warnings є structured values, а не plain strings.

```ts
for (const warning of decoded.warnings) {
  console.warn(warning.code, warning.byteRange, warning.details);
}
```

Поширені codes:

- `ENCODING_LOW_CONFIDENCE`;
- `ENCODING_FALLBACK_USED`;
- `ENCODING_BOM_CONFLICT`;
- `ENCODING_METADATA_CONFLICT`;
- `ENCODING_AMBIGUOUS_CANDIDATES`;
- `ENCODING_BACKEND_SUBSTITUTION`;
- `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`;
- `ENCODING_INVALID_SEQUENCE_REPLACED`;
- `ENCODING_INCOMPLETE_STREAM_SEQUENCE`;
- `ENCODING_TRUNCATED_SAMPLE`.

`ENCODING_TRUNCATED_SAMPLE` означає, що byte-derived detection прийняла рішення за bounded
sample, тому bytes за межами sample не брали участі у validation/heuristics.

## Errors

Fatal states представлені `EncodingError`.

```ts
try {
  const decoded = decodeDocumentSync(bytes, {
    profile: "strictUtf8",
  });
  console.log(decoded.text);
} catch (error) {
  if (error instanceof EncodingError) {
    console.error(error.code, error.byteRange, error.warnings);
  }
}
```

`tryDecodeDocument` повертає ті самі fatal diagnostics у `EncodingResult` без throw.

## Caveat для string input

`string` input уже декодований до виклику `@relicmem/encoding`.

```ts
const decoded = decodeDocumentSync("Привіт", {
  sourceMap: "exact",
});

console.log(decoded.warnings.map((warning) => warning.code));
```

Для exact source workflows передавайте original bytes. String input створює synthetic UTF-8
bytes і не може відновити original byte ranges, BOM або legacy byte representation.
