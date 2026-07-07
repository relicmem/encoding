# Parser Integration

`@relicmem/md-parser` should depend on the public `DecodedDocument` and root encode functions, not
on internal detector, decoder, source model, backend, or profile policy classes.

## Basic Flow

```ts
import { BUILT_IN_ENCODING_PROFILES, decodeDocument } from "@relicmem/encoding";
import { createParser } from "@relicmem/md-parser";

const decoded = await decodeDocument(input, {
  profile: "relicmem",
  minConfidence: 0.75,
  defaultEncoding: "utf-8",
  allowedEncodings: ["utf-8", "utf-16le", "utf-16be", "windows-1251", "windows-1252", "koi8-r"],
  sourceMap: "exact",
});

const profile = BUILT_IN_ENCODING_PROFILES.relicmem;
const mode = profile.nativeByteSafeEncodings.includes(decoded.detection.encoding)
  ? "native-byte-safe"
  : "transcode-compatibility";

const parser = createParser();
const result = await parser.parse({
  kind: "decoded-document",
  value: decoded,
  mode,
});
```

## Trigger Encoding

Compile parser triggers through the root encode API instead of importing backend internals:

```ts
import { canEncodeText, encodeText, tryEncodeText } from "@relicmem/encoding";

const trigger = tryEncodeText("#", decoded.detection.encoding);

if (!trigger.ok) {
  // Convert trigger.error into a compile-time parser diagnostic.
}
```

`canEncodeText` is useful for guard checks, while `encodeText` should be used when the caller wants
bytes and structured replacement warnings.

## Mode Selection

`native-byte-safe` is suitable for UTF-8 and ASCII-compatible single-byte encodings:

- `utf-8`;
- `windows-1251`;
- `windows-1252`;
- `iso-8859-1`;
- `iso-8859-5`;
- `koi8-r`;
- `cp866`.

`utf-16le` and `utf-16be` should go through `transcode-compatibility`, where the parser works with
decoded text and source ranges map back through `DecodedDocument.offsetMap`.

## Diagnostics

The parser should convert:

- fatal `EncodingError` into parser diagnostic phase `encoding`;
- `DecodedDocument.warnings` into warning diagnostics without losing `byteRange`, `textRange`, and
  `details`;
- the `tryDecodeDocument` failure branch into the same diagnostic path as thrown
  `EncodingError`.

## Important Constraint

In source-perfect parser mode, do not pass `string` input. Pass bytes; otherwise
`@relicmem/encoding` returns a synthetic byte source with the warning
`ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`.
