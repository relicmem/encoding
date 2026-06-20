# Release notes v1 candidate

This document records the release-readiness state for the first production delivery of
`@relicmem/encoding`. Actual versioning, tag policy, publish gate, and recovery workflow belong to
the separate task `ENC-046`.

## Compatibility

- Runtime: Node.js `>=20.19`.
- Package format: ESM package (`"type": "module"`) with root entrypoint `./dist/index.js`.
- TypeScript declarations: `./dist/index.d.ts`.
- Public package export: only package root `"."`; internal detector/decoder/source modules are not
  package subpath API.
- Supported input: `string`, `Uint8Array`, `ArrayBuffer`, sync/async `Iterable<Uint8Array>`, and
  `ReadableStream<Uint8Array>` through public decode APIs.

## Public API

The root package export is intended for integrators and contains:

- `decodeDocument`, `decodeDocumentSync`, `tryDecodeDocument`;
- `detectEncoding`;
- `createDecodingStream`;
- public contracts, `EncodingError`, warning/result helpers;
- encoding label helpers `normalizeEncodingLabel`, `tryNormalizeEncodingLabel`,
  `aliasesForEncoding`, `isRelicMEMEncodingName`;
- `BUILT_IN_ENCODING_PROFILES` for choosing parser integration mode without internal imports.

Detector, decoder, source-buffer, offset-map builder, profile-policy, and input-normalization
helpers remain implementation modules. They may be tested directly inside the repository, but they
are not documented as the package contract.

## Encoding Support

Canonical encodings v1:

- `utf-8`;
- `utf-16le`, `utf-16be`;
- `windows-1251`, `windows-1252`;
- `iso-8859-1`, `iso-8859-5`;
- `koi8-r`;
- `cp866`.

Built-in profiles v1: `relicmem`, `strictUtf8`, `legacyCyrillic`, `webCompat`.

## Dependency Footprint and Backends

The package has no runtime `dependencies` or `optionalDependencies`.

Default exact decoding is provided by the native backend, which supports v1 Unicode and
single-byte encodings plus exact source maps. The non-exact `TextDecoder` backend may be used only
with explicit `sourceMap: "none"` or where registry policy allows loss of exact source maps. The
optional `iconv-lite` adapter remains an injected zero-dependency adapter and does not add a
package dependency.

## Known limitations

- The library is not a Markdown parser and does not normalize Markdown, line endings, or Unicode
  form.
- The default profile does not perform aggressive universal auto-detect; legacy candidates are
  limited by profile policy.
- v1 does not support every legacy encoding.
- `string` input has already been decoded and creates synthetic UTF-8 bytes, so source-perfect
  workflows should pass byte input.
- Non-exact backends cannot satisfy `sourceMap: "exact"` for `relicmem` parser integration.
- Package version `0.0.0` is a placeholder for unreleased workspace state. The release workflow
  blocks real publication of this version; a production release should update the `package.json`
  version in a reviewed commit.

## Release-readiness checks

The permanent guard for package readiness is in `tests/package-release-readiness.test.ts` and
checks:

- whitelisted runtime exports from the package root;
- package `files`, `main`, `types`, and `exports`;
- absence of runtime and optional dependencies.

Before release delivery, these commands should pass:

```bash
npm run check
npm pack --dry-run
npm run release:check
```
