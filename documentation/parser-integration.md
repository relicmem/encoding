# Інтеграція parser

`@relicmem/md-parser` має залежати від public `DecodedDocument`, а не від internal detector,
decoder, source model або profile policy classes.

## Базовий flow

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

## Вибір mode

`native-byte-safe` підходить для UTF-8 і ASCII-compatible single-byte encodings:

- `utf-8`;
- `windows-1251`;
- `windows-1252`;
- `iso-8859-1`;
- `iso-8859-5`;
- `koi8-r`;
- `cp866`.

`utf-16le` і `utf-16be` мають іти через `transcode-compatibility`, де parser працює з
decoded text, а source ranges мапляться назад через `DecodedDocument.offsetMap`.

## Diagnostics

Parser має конвертувати:

- fatal `EncodingError` у parser diagnostic phase `encoding`;
- `DecodedDocument.warnings` у warning diagnostics без втрати `byteRange`, `textRange` і
  `details`;
- `tryDecodeDocument` failure branch у той самий diagnostic path, що й thrown
  `EncodingError`.

## Важливе обмеження

У source-perfect parser mode не передавайте `string` input. Передавайте bytes, інакше
`@relicmem/encoding` поверне synthetic byte source з warning
`ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`.
