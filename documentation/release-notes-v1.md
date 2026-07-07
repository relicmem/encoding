# Release notes v1 candidate

This document records the release-readiness state for the first production delivery of
`@relicmem/encoding`. Actual versioning, tag policy, publish gate, and recovery workflow belong to
the separate task `ENC-046`.

## Compatibility

- Runtime: Node.js `>=24.17`.
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
- `encodeText`, `tryEncodeText`, `canEncodeText`;
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

## Package Contents

The npm package contains the runtime build, package metadata, `README.md`, `LICENSE`, and `NOTICE`.
`NOTICE` is intentionally packaged because the runtime includes encoding labels and compact mapping
data with third-party provenance requirements.

Repository governance and long-form documentation stay out of the npm tarball:
`CONTRIBUTING.md`, `SECURITY.md`, `TRADEMARKS.md`, `documentation/*`, `docs/*`, source, tests,
fixtures, and release scripts are repository-only.

## Known limitations

- The library is not a Markdown parser and does not normalize Markdown, line endings, or Unicode
  form.
- The default profile does not perform aggressive universal auto-detect; legacy candidates are
  limited by profile policy.
- v1 does not support every legacy encoding.
- `string` input has already been decoded and creates synthetic UTF-8 bytes, so source-perfect
  workflows should pass byte input.
- Non-exact backends cannot satisfy `sourceMap: "exact"` for `relicmem` parser integration.
- Package version `0.0.2` carries the public encode API milestone. Future production releases
  should update the `package.json` version in a reviewed commit before running the publish gate.

## Release-readiness checks

The permanent guard for package readiness is in `tests/package-release-readiness.test.ts` and
checks:

- whitelisted runtime exports from the package root;
- package `files`, `main`, `types`, and `exports`;
- required package notices and prohibited repository-only files;
- absence of runtime and optional dependencies.

Before release delivery, these commands should pass:

```bash
npm run check
npm pack --dry-run
npm run release:check
```
