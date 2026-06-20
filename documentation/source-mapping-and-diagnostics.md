# Source Mapping and Diagnostics

## Offset semantics

All ranges are half-open intervals: `[start, end)`.

```ts
const byteRange = decoded.offsetMap.byteRangeForTextRange({ start: 0, end: 1 });
const textRange = decoded.offsetMap.textRangeForByteRange({ start: 3, end: 4 });
```

`CharacterOffset` means a JavaScript UTF-16 code unit offset, compatible with `string.length` and
`slice`.

## `OffsetMap`

`OffsetMap` is segment-based. It is not a per-character array by default.

```ts
for (const segment of decoded.offsetMap.segments()) {
  console.log(segment.kind, segment.byteRange, segment.textRange);
}
```

Typical segment kinds:

- `identity` - byte offsets and text offsets move 1:1;
- `encoded` - one character takes multiple bytes, or mapping is not 1:1;
- `bom` - BOM bytes that can have a collapsed text range under `stripBom: true`;
- `replacement` - invalid bytes replaced by `replacementCharacter`;
- `synthetic` - bytes created for already-decoded string input.

## `LineIndex`

`LineIndex` does not normalize line endings. `\r\n` counts as one line break, and standalone `\r`
and `\n` are also supported.

```ts
const firstLineText = decoded.lineIndex.lineTextRange(1);
const firstLineBytes = decoded.lineIndex.lineByteRange(1, true);
const position = decoded.lineIndex.positionAtByteOffset(10, "nearest");
```

Line and column numbering starts at `1`.

## Warnings

Warnings are structured values, not plain strings.

```ts
for (const warning of decoded.warnings) {
  console.warn(warning.code, warning.byteRange, warning.details);
}
```

Common codes:

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

`ENCODING_TRUNCATED_SAMPLE` means byte-derived detection made a decision from a bounded sample, so
bytes outside the sample did not participate in validation/heuristics.

## Errors

Fatal states are represented by `EncodingError`.

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

`tryDecodeDocument` returns the same fatal diagnostics in `EncodingResult` without throwing.

## Caveat for String Input

`string` input has already been decoded before `@relicmem/encoding` is called.

```ts
const decoded = decodeDocumentSync("Hello", {
  sourceMap: "exact",
});

console.log(decoded.warnings.map((warning) => warning.code));
```

For exact source workflows, pass original bytes. String input creates synthetic UTF-8 bytes and
cannot recover original byte ranges, BOM, or legacy byte representation.
