# Прогрес реалізації `@rmem/encoding`

Цей документ є основним чеклістом реалізації технічного завдання з `docs/SPEC.md`.

## Правило актуалізації

Після того як користувач зафіксує виконання задачі, цей документ потрібно одразу оновити в тому самому наборі змін: позначити відповідний checkbox, за потреби додати коротку примітку до задачі або етапу, і оновити `docs/index.md`, якщо змінився склад або короткий опис документів у `docs/`.

Позапланові задачі, які виникають під час реалізації і виконуються поза початковим планом, потрібно додавати до етапу `E99 Позапланові задачі` з новим унікальним ідентифікатором.

## E01. Основа пакета і публічний контракт

- [x] [ENC-001](tasks/ENC-001-project-scaffold.md) — створити package scaffold, структуру модулів і базові entrypoints. Виконано: додано package metadata, TypeScript-конфіги, public entrypoint, рекомендовану структуру `src/`, `tests/` і `fixtures/`; `typecheck` і `build` проходять.
- [x] [ENC-002](tasks/ENC-002-tooling-quality-gates.md) — налаштувати TypeScript, lint, format, test і CI quality gates. Виконано: strict TypeScript залишено активним, додано ESLint, Prettier, Vitest і локальний `check` gate, який запускає `typecheck`, `lint`, `format:check`, `test` і `build`.
- [x] [ENC-003](tasks/ENC-003-fixture-infrastructure.md) — створити інфраструктуру fixtures і helper APIs для поведінкових тестів. Виконано: додано manifest/schema/README для fixtures, підтримку binary `bytesPath` і small invalid payloads через `bytesHex`, typed test helper для читання `Uint8Array` без text decoding і smoke tests.
- [x] [ENC-004](tasks/ENC-004-public-contracts.md) — описати публічні типи, exports і стабільну межу API. Виконано: додано type-only public contracts для encoding inputs/options/results, diagnostics, detection, source model, backend info, profiles і stream API; root `src/index.ts` експортує лише стабільну contract boundary без implementation classes.
- [x] [ENC-005](tasks/ENC-005-error-result-primitives.md) — реалізувати `EncodingError`, warnings і structured result primitives. Виконано: додано runtime `EncodingError`, diagnostic code list, warning/error/result factory helpers, immutable warning arrays/details/ranges і focused tests для fatal diagnostics та `EncodingResult`.

## E02. Source model, ranges і позиціонування

- [x] [ENC-006](tasks/ENC-006-source-buffer.md) — реалізувати `SourceBuffer` і правила володіння raw bytes. Виконано: додано immutable `SourceBuffer` runtime helper для `Uint8Array`, `ArrayBuffer` і зібраних chunks; публічні читання та `slice()` повертають копії, а focused tests перевіряють ownership, BOM/invalid bytes і range validation.
- [x] [ENC-007](tasks/ENC-007-range-bias-semantics.md) — реалізувати half-open ranges, validation і `OffsetBias`. Виконано: додано спільні immutable helpers для `SourceByteRange`, `TextRange`, `OffsetBias` і biased offset projection; `SourceBuffer.slice()` переведено на спільну range validation; focused tests покривають collapsed BOM ranges, segment boundary bias і out-of-bounds offsets.
- [x] [ENC-008](tasks/ENC-008-offset-map-core.md) — реалізувати segment-based `OffsetMap`. Виконано: додано immutable `OffsetMap` runtime helper із segment validation, точним `identity` mapping, bias-based projection для non-identity segments, stable frozen `segments()` і focused tests для BOM, replacement, synthetic та validation сценаріїв.
- [x] [ENC-009](tasks/ENC-009-offset-map-builders.md) — реалізувати exact mapping builders для підтримуваних encoding families. Виконано: додано exact builder-и для canonical UTF-8, UTF-16LE/BE і single-byte encodings; BOM формує `bom` segments, invalid sequences у fatal policy повертають failure без partial map, а replace policy створює `replacement` segments і warnings.
- [x] [ENC-010](tasks/ENC-010-line-index.md) — реалізувати `LineIndex` без нормалізації line endings. Виконано: додано immutable `LineIndex` для decoded text + `OffsetMap`, підтримку LF/CRLF/CR без зміни тексту, 1-based line/column positions, `lineByteRange` через original source map і focused tests для empty, trailing newline, mixed endings та UTF-8 byte positions.
- [x] [ENC-011](tasks/ENC-011-string-input-model.md) — реалізувати already-decoded string input і synthetic byte behavior. Виконано: додано synthetic UTF-8 builder для string input, `createDecodedStringDocument` з `detection.source: "explicit"`, metadata explicit/default encoding, `synthetic` offset segments, warning `ENCODING_TEXT_INPUT_SYNTHETIC_BYTES` для exact source map і focused tests.

## E03. Profiles, labels, options і metadata

- [x] [ENC-012](tasks/ENC-012-encoding-registry-labels.md) — реалізувати canonical encoding registry і label normalization. Виконано: додано canonical v1 registry, aliases для common labels, `normalizeEncodingLabel`/`tryNormalizeEncodingLabel`, immutable alias lookup, webCompat WHATWG remapping `iso-8859-1`/`latin1` до `windows-1252` і підключення string input до спільного normalizer.
- [x] [ENC-013](tasks/ENC-013-options-normalization.md) — реалізувати нормалізацію та валідацію decode/detect options. Виконано: додано спільний normalizer для detect/decode options, validated profile resolution, canonical allowed/default/explicit encoding checks, profile defaults для decode policy/backend/sample size і focused tests для конфліктів опцій.
- [x] [ENC-014](tasks/ENC-014-built-in-profiles.md) — реалізувати `strictUtf8`, `rmem`, `legacyCyrillic` і `webCompat` профілі. Виконано: винесено immutable built-in profile metadata і profile policies у `src/profile`, зафіксовано default `rmem`, strict UTF-8, legacy Cyrillic focus, webCompat metadata/WHATWG behavior, custom profile validation і focused tests.
- [x] [ENC-015](tasks/ENC-015-metadata-sniffing.md) — реалізувати metadata extraction і правила участі metadata у detection. Виконано: додано metadata sniffing для `declaredEncoding`, HTTP `content-type` charset і HTML meta charset, нормалізацію labels через registry, immutable metadata candidate/warnings, правила пріоритету explicit/BOM над metadata та focused tests.
- [x] [ENC-016](tasks/ENC-016-confidence-policy.md) — реалізувати scoring, candidates, confidence і warning policy. Виконано: додано deterministic `ConfidencePolicy` для candidate factory, stable sorting/tie-breaking, fallback candidate, `minConfidence` checks і warnings `ENCODING_LOW_CONFIDENCE`, `ENCODING_FALLBACK_USED`, `ENCODING_AMBIGUOUS_CANDIDATES`; підключено candidate factory до metadata/string input і додано focused tests.

## E04. Detection pipeline

- [x] [ENC-017](tasks/ENC-017-bom-detector.md) — реалізувати BOM detector. Виконано: додано deterministic BOM detector для UTF-8, UTF-16LE і UTF-16BE, candidate `source: "bom"` з `bomLength`, explicit/BOM conflict warning або fatal policy, disallowed BOM handling і focused tests для коротких inputs та metadata priority.
- [x] [ENC-018](tasks/ENC-018-utf8-validator.md) — реалізувати deterministic UTF-8 validator. Виконано: додано streaming-friendly UTF-8 validator без декодування, invalid sequence ranges для leading/continuation/incomplete cases, fatal `ENCODING_INVALID_SEQUENCE` policy, `utf8-validation` candidate з confidence `1` для валідного UTF-8 без explicit/BOM сигналу і focused tests для overlong, surrogate, out-of-range та split multibyte сценаріїв.
- [x] [ENC-019](tasks/ENC-019-utf16-detector.md) — реалізувати UTF-16 heuristic detector. Виконано: додано UTF-16 detector із BOM-first поведінкою, conservative NUL/printable/parity heuristic для UTF-16LE/BE, profile-gated `utf16Heuristics`, weak/unsupported signal warnings, `tryDetectUtf16` і focused tests.
- [x] [ENC-020](tasks/ENC-020-legacy-detector.md) — реалізувати legacy Cyrillic heuristic detector. Виконано: додано deterministic legacy detector для `windows-1251`, `koi8-r`, `cp866`, `iso-8859-5` і `windows-1252`, profile/allowed-candidate gating, `rmem` valid UTF-8 suppression, ASCII-only слабкий результат, ambiguous warnings і focused tests.
- [x] [ENC-021](tasks/ENC-021-composite-detector.md) — реалізувати composite detection decision pipeline. Виконано: додано deterministic composite detector поверх options/profile normalization, BOM, metadata, UTF-8 validation, UTF-16 heuristic, legacy heuristic і fallback policy; результат повертає повний `EncodingDetectionResult` з stable candidates/warnings, BOM-aware label selection і backend placeholder без decoding/OffsetMap; додано focused tests для priority rules, fallback і strict UTF-8 fatal behavior.
- [x] [ENC-022](tasks/ENC-022-detect-encoding-api.md) — реалізувати public `detectEncoding` API. Виконано: додано root export `detectEncoding`, який синхронно делегує в composite detection pipeline для `Uint8Array`, повертає public `EncodingDetectionResult` без decoding/`OffsetMap` і має focused tests для result shape, byte-only input, sample handling та fatal option conflicts.

## E05. Decoder backends і controlled decoding

- [x] [ENC-023](tasks/ENC-023-backend-contract-registry.md) — реалізувати decoder backend contract і registry. Виконано: додано runtime `DecoderRegistry` з immutable backend info snapshots, deterministic selection за `backendPreference`, capability checks для `canDecode` і `exactSourceMap`, structured `ENCODING_BACKEND_SUBSTITUTION` warnings та fatal errors для unsupported encoding/source map unavailable.
- [x] [ENC-024](tasks/ENC-024-native-unicode-backend.md) — реалізувати exact UTF-8/UTF-16 native backend. Виконано: додано `NativeUnicodeBackend` з власним UTF-8/UTF-16LE/BE decoding поверх exact `OffsetMapBuilder`, structured fatal errors для invalid sequences, replacement warnings/segments, BOM handling, sourceMap `none` suppression і focused tests; `check` проходить.
- [ ] [ENC-025](tasks/ENC-025-single-byte-backend.md) — реалізувати exact single-byte legacy backend.
- [ ] [ENC-026](tasks/ENC-026-external-backend-adapters.md) — інтегрувати optional external decoder backends.
- [ ] [ENC-027](tasks/ENC-027-controlled-decoding-policy.md) — реалізувати fatal/replace decoding policy і backend warnings.
- [ ] [ENC-028](tasks/ENC-028-backend-encode-support.md) — реалізувати encode support у backend layer.

## E06. High-level decode API

- [ ] [ENC-029](tasks/ENC-029-input-normalization.md) — реалізувати input normalization для bytes, buffers, iterables і streams.
- [ ] [ENC-030](tasks/ENC-030-sync-decode-pipeline.md) — реалізувати `decodeDocumentSync`.
- [ ] [ENC-031](tasks/ENC-031-async-decode-pipeline.md) — реалізувати `decodeDocument`.
- [ ] [ENC-032](tasks/ENC-032-try-decode-result.md) — реалізувати `tryDecodeDocument`.
- [ ] [ENC-033](tasks/ENC-033-decoded-document-assembly.md) — складати immutable `DecodedDocument`.
- [ ] [ENC-034](tasks/ENC-034-parser-integration-metadata.md) — expose metadata для режимів інтеграції parser.

## E07. Stream API

- [ ] [ENC-035](tasks/ENC-035-detection-sampler.md) — реалізувати stream detection sampler.
- [ ] [ENC-036](tasks/ENC-036-decoding-stream-write.md) — реалізувати `DecodingStream.write`.
- [ ] [ENC-037](tasks/ENC-037-stream-pending-state.md) — обробляти pending multibyte state і stream finalization errors.
- [ ] [ENC-038](tasks/ENC-038-stream-end-document.md) — реалізувати `DecodingStream.end` і повний stream `DecodedDocument`.

## E08. Fixtures, тестове покриття, документація і release readiness

- [ ] [ENC-039](tasks/ENC-039-minimal-fixture-corpus.md) — створити мінімальний fixture corpus зі специфікації.
- [ ] [ENC-040](tasks/ENC-040-detection-profile-tests.md) — покрити detection і profiles поведінковими тестами.
- [ ] [ENC-041](tasks/ENC-041-source-map-line-tests.md) — покрити `OffsetMap` і `LineIndex` тестами.
- [ ] [ENC-042](tasks/ENC-042-decoder-policy-error-tests.md) — покрити decoder policies, warnings і errors тестами.
- [ ] [ENC-043](tasks/ENC-043-stream-input-tests.md) — покрити stream та async input сценарії.
- [ ] [ENC-044](tasks/ENC-044-public-docs-examples.md) — підготувати public usage docs і integration examples.
- [ ] [ENC-045](tasks/ENC-045-release-readiness.md) — перевірити package quality, exports, CI і release readiness.

## E99. Позапланові задачі

Поки порожньо. Сюди додаються задачі, які з'являються під час реалізації проекту і виконуються поза рамками початкового плану.
