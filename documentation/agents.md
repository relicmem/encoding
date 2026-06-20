# Agent Reference for `@relicmem/encoding`

This is a single reference for agents. For user-facing documentation, see the structured files in
this directory.

## Purpose

`@relicmem/encoding` is the byte-to-text intake layer for `RelicMEM` documents. The library does
not parse Markdown. It detects encoding, decodes bytes, preserves raw source, builds `OffsetMap`
and `LineIndex`, and returns detection metadata, backend metadata, warnings, and fatal
`EncodingError`.

## Core Public Imports

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

Public examples should import from the package root. Do not document internal modules as a contract
for integrators.

## High-level Decode API

```ts
const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});
```

`decodeDocument` accepts `string`, `Uint8Array`, `ArrayBuffer`, `Iterable<Uint8Array>`,
`AsyncIterable<Uint8Array>`, and `ReadableStream<Uint8Array>`. `decodeDocumentSync` accepts only
sync input. Fatal encoding states throw `EncodingError`.

## Detect-only API

```ts
const detection = detectEncoding(bytes, {
  profile: "webCompat",
  metadata: {
    contentType: "text/html; charset=latin1",
  },
});
```

Detect-only does not decode the full document and does not build a source map. Use it for routing,
logging, diagnostics, and tests.

## Stream API

```ts
const stream = createDecodingStream({
  profile: "relicmem",
  sourceMap: "exact",
});

const chunks = stream.write(chunk);
const document = stream.end();
```

`write` can return `[]` until sampling/detection completes or when the decoder is holding a
pending multibyte sequence. `end` finalizes the stream and returns the complete `DecodedDocument`,
or throws `ENCODING_INCOMPLETE_STREAM_SEQUENCE` under fatal policy.

## Profiles

- `relicmem` - default for CLI/import and parser integration; exact source maps, UTF-8 validation
  stronger than legacy heuristics, default `minConfidence: 0.75`.
- `strictUtf8` - for new documents; legacy heuristics disabled, invalid UTF-8 fatal.
- `legacyCyrillic` - import of old Cyrillic documents; focus on `windows-1251`, `koi8-r`,
  `cp866`, `iso-8859-5`; ambiguous close scores produce a warning.
- `webCompat` - web/HTML sources; metadata sniffing and WHATWG label behavior, for example
  `latin1` can become `windows-1252`.

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

Ranges are half-open: `[start, end)`. `CharacterOffset` is a JavaScript UTF-16 code unit offset.
`LineIndex` does not normalize line endings. Under `stripBom: true`, BOM remains in raw bytes and
is represented by a collapsed `bom` segment.

## Caveat for String Input

String input has already been decoded. The library creates synthetic UTF-8 bytes for it. If an
exact source map is requested, expect the warning `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES`. For
source-perfect parser workflows, always pass byte input.

## Parser Integration

The parser should accept the public `DecodedDocument`:

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

Native byte-safe encodings in v1: `utf-8`, `windows-1251`, `windows-1252`, `iso-8859-1`,
`iso-8859-5`, `koi8-r`, `cp866`. UTF-16 variants should go through transcode compatibility with
range mapping through `DecodedDocument.offsetMap`.

## Diagnostics

Runtime diagnostic messages must be English. Public documentation in `README.md` and
`documentation/*` is English. Internal project memory under `docs/*` and code comments are
Ukrainian.

Warnings/errors must not be converted to plain strings in public integration. Preserve `code`,
`byteRange`, `textRange`, `details`, and `warnings`.

## Documentation Verification

Public examples should be covered by `tests/public-docs-examples.test.ts`. After changing
examples, run `npm run typecheck` and relevant tests; before finishing the task, run
`npm run check`.
