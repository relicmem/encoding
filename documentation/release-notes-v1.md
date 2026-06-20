# Release notes v1 candidate

Цей документ фіксує release-readiness стан для першої production delivery
`@relicmem/encoding`. Фактичне versioning, tag policy, publish gate і recovery workflow належать до
окремої задачі `ENC-046`.

## Сумісність

- Runtime: Node.js `>=20.19`.
- Package format: ESM package (`"type": "module"`) з root entrypoint `./dist/index.js`.
- TypeScript declarations: `./dist/index.d.ts`.
- Public package export: тільки package root `"."`; internal detector/decoder/source modules не є
  package subpath API.
- Supported input: `string`, `Uint8Array`, `ArrayBuffer`, sync/async `Iterable<Uint8Array>` і
  `ReadableStream<Uint8Array>` через public decode APIs.

## Public API

Root package export призначений для інтеграторів і містить:

- `decodeDocument`, `decodeDocumentSync`, `tryDecodeDocument`;
- `detectEncoding`;
- `createDecodingStream`;
- public contracts, `EncodingError`, warning/result helpers;
- encoding label helpers `normalizeEncodingLabel`, `tryNormalizeEncodingLabel`,
  `aliasesForEncoding`, `isRelicMEMEncodingName`;
- `BUILT_IN_ENCODING_PROFILES` для вибору parser integration mode без internal imports.

Detector, decoder, source-buffer, offset-map builder, profile-policy і input-normalization helpers
залишаються implementation modules. Вони можуть тестуватись напряму всередині репозиторію, але не
документуються як package contract.

## Підтримка кодувань

Canonical encodings v1:

- `utf-8`;
- `utf-16le`, `utf-16be`;
- `windows-1251`, `windows-1252`;
- `iso-8859-1`, `iso-8859-5`;
- `koi8-r`;
- `cp866`.

Built-in profiles v1: `relicmem`, `strictUtf8`, `legacyCyrillic`, `webCompat`.

## Dependency footprint і backends

Пакет не має runtime `dependencies` або `optionalDependencies`.

Default exact decoding забезпечує native backend, який підтримує v1 Unicode і single-byte encodings
та exact source maps. Non-exact `TextDecoder` backend може бути використаний лише за явного
`sourceMap: "none"` або там, де registry policy дозволяє втрату exact source map. Optional
`iconv-lite` adapter залишається ін'єкційним zero-dependency adapter і не додає package dependency.

## Known limitations

- Бібліотека не є Markdown parser і не нормалізує Markdown, line endings або Unicode form.
- Default profile не робить агресивний universal auto-detect; legacy candidates обмежені profile
  policy.
- v1 не підтримує всі legacy encodings.
- `string` input уже декодований і створює synthetic UTF-8 bytes, тому source-perfect workflows
  мають передавати byte input.
- Non-exact backends не можуть задовольнити `sourceMap: "exact"` для `relicmem` parser integration.
- Package version `0.0.0` є placeholder для unreleased workspace state. Release workflow блокує
  реальний publish цієї версії; production release має оновити `package.json` version у reviewed
  commit.

## Release-readiness checks

Постійний guard для package readiness знаходиться в `tests/package-release-readiness.test.ts` і
перевіряє:

- whitelist runtime exports із package root;
- package `files`, `main`, `types` і `exports`;
- відсутність runtime та optional dependencies.

Перед release delivery мають проходити:

```bash
npm run check
npm pack --dry-run
npm run release:check
```
