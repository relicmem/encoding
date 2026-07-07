# @relicmem/encoding

`@relicmem/encoding` is the byte-to-text intake layer for `RelicMEM` documents. The package
detects encoding, decodes bytes with the selected policy, preserves raw source bytes, and returns
source mapping data for higher-level parser layers.

The package is not a Markdown parser. Its job is to provide `@relicmem/md-parser` and other
integrators with a decoded document that includes:

- canonical encoding detection and confidence data;
- exact byte-to-text source maps where the active profile requires them;
- a line index without line ending normalization;
- BOM, backend, warning, and error metadata;
- fragment encoding for parser triggers and other byte-level matchers;
- stream-safe decoding for split multibyte sequences.

## Quick Example

```ts
import { decodeDocument } from "@relicmem/encoding";

const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});

console.log(decoded.text);
console.log(decoded.detection.encoding);
console.log(decoded.lineIndex.positionAtTextOffset(0));
```

To compile short string fragments into bytes for the active encoding, use the root encode API:

```ts
import { encodeText } from "@relicmem/encoding";

const trigger = encodeText("#", decoded.detection.encoding);
console.log(trigger.bytes);
```

Use byte input (`Uint8Array`, `ArrayBuffer`, iterables, or streams) when source ranges matter.
String input has already been decoded before this package sees it; the library creates synthetic
UTF-8 bytes for it, so it is not source-perfect.

## Documentation

- [Documentation index](documentation/README.md)
- [Getting started](documentation/getting-started.md)
- [API reference](documentation/api.md)
- [Encoding profiles](documentation/profiles.md)
- [Source mapping and diagnostics](documentation/source-mapping-and-diagnostics.md)
- [Parser integration](documentation/parser-integration.md)
- [Encoding data provenance](documentation/encoding-data-provenance.md)
- [Release notes for 0.0.2](documentation/release-notes-v1.md)
- [Release automation](documentation/release-automation.md)
- [Contributor notes](documentation/contributors.md)
- [Agent reference](documentation/agents.md)

Examples are mirrored in `tests/public-docs-examples.test.ts`, so they are checked by the regular
TypeScript and test gates.
