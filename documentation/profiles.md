# Encoding Profiles

Profiles are detection/decoding policies, not short aliases. The default profile is `relicmem`.

## `relicmem`

Default for CLI/import flows and future `@relicmem/md-parser` integration.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});
```

Properties:

- explicit encoding has the highest priority;
- BOM beats metadata/heuristics when explicit encoding is not set;
- UTF-8 validation is a stronger signal than legacy heuristics;
- `windows-1251` and `windows-1252` are not selected for valid UTF-8 without an
  explicit/metadata signal;
- default `minConfidence` is `0.75`;
- exact source maps are required by default.

## `strictUtf8`

For new documents where legacy fallback is an error.

```ts
const decoded = decodeDocumentSync(bytes, {
  profile: "strictUtf8",
});
```

Invalid UTF-8 is fatal by default. Legacy heuristics are disabled.

## `legacyCyrillic`

For importing old Ukrainian and Russian documents.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "legacyCyrillic",
  allowedEncodings: ["utf-8", "windows-1251", "koi8-r", "cp866", "iso-8859-5"],
});
```

The profile focuses on `windows-1251`, `koi8-r`, `cp866`, and `iso-8859-5`, but it does not
override explicit encoding or BOM. If several legacy candidates have close scores, the result
contains the warning `ENCODING_AMBIGUOUS_CANDIDATES`.

## `webCompat`

For HTML/Markdown from web sources.

```ts
const decoded = await decodeDocument(bytes, {
  profile: "webCompat",
  metadata: {
    contentType: "text/html; charset=latin1",
  },
  sourceMap: "none",
});
```

The profile supports metadata sniffing and WHATWG label behavior. For example, `latin1` or
`iso-8859-1` in a web-compatible context can normalize to `windows-1252`. By default, the profile
keeps `sourceMap: "exact"` and selects an exact backend first, so a normal decode does not create a
backend substitution warning only because of the profile default. If an exact source map is not
needed, `sourceMap: "none"` together with explicit `backendPreference` allows non-exact backends
without a source-map fatal error.

## Custom profile

A custom profile must explicitly describe allowed encodings, native byte-safe encodings, and
policies. Use it only when the built-in profiles do not match the product mode.

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
