# Індекс пам'яті проекту

docs/SPEC.md — технічне завдання `@rmem/encoding`, цілі, API, source model, detection pipeline, профілі, backends, stream API, критерії приймання і мінімальні fixtures.
docs/plan/progress.md — структурований чекліст повної реалізації проекту, правила актуалізації прогресу, меж задач, багфіксів, release automation та позапланових задач.
README.md — компактний публічний огляд `@rmem/encoding`, основні можливості і посилання на документацію.
documentation/README.md — індекс публічної документації для людей і агентів.
documentation/getting-started.md — quick start для decode, detect-only, stream API і правила вибору byte input.
documentation/api.md — практичний довідник public API, опцій decode/detect/stream і `DecodedDocument`.
documentation/profiles.md — пояснення built-in profiles `rmem`, `strictUtf8`, `legacyCyrillic`, `webCompat` і custom profile.
documentation/source-mapping-and-diagnostics.md — source map, line index, warnings/errors і caveat для string input.
documentation/parser-integration.md — приклад інтеграції з `@rmem/md-parser` і правила вибору parser mode.
documentation/release-notes-v1.md — release notes v1 candidate: сумісність, public API, dependency footprint, known limitations і readiness checks.
documentation/release-automation.md — release automation: GitHub workflow, npm scripts, publish gate, secrets, branch policy і recovery steps.
documentation/contributors.md — contributor notes, межа public API і правило англомовних runtime messages.
documentation/agents.md — монолітний довідник для агентів із ключовими контрактами, сценаріями та обмеженнями.
docs/plan/tasks/ENC-001-project-scaffold.md — задача створення package scaffold, структури модулів і базових entrypoints.
docs/plan/tasks/ENC-002-tooling-quality-gates.md — задача налаштування TypeScript, lint, format, test і CI quality gates.
docs/plan/tasks/ENC-003-fixture-infrastructure.md — задача створення інфраструктури fixtures і helper APIs для поведінкових тестів.
docs/plan/tasks/ENC-004-public-contracts.md — задача опису публічних типів, exports і стабільної межі API.
docs/plan/tasks/ENC-005-error-result-primitives.md — задача реалізації `EncodingError`, warnings і structured result primitives.
docs/plan/tasks/ENC-006-source-buffer.md — задача реалізації `SourceBuffer` і правил володіння raw bytes.
docs/plan/tasks/ENC-007-range-bias-semantics.md — задача реалізації half-open ranges, validation і `OffsetBias`.
docs/plan/tasks/ENC-008-offset-map-core.md — задача реалізації segment-based `OffsetMap`.
docs/plan/tasks/ENC-009-offset-map-builders.md — задача реалізації exact mapping builders для підтримуваних encoding families.
docs/plan/tasks/ENC-010-line-index.md — задача реалізації `LineIndex` без нормалізації line endings.
docs/plan/tasks/ENC-011-string-input-model.md — задача реалізації already-decoded string input і synthetic byte behavior.
docs/plan/tasks/ENC-012-encoding-registry-labels.md — задача реалізації canonical encoding registry і label normalization.
docs/plan/tasks/ENC-013-options-normalization.md — задача нормалізації та валідації decode/detect options.
docs/plan/tasks/ENC-014-built-in-profiles.md — задача реалізації `strictUtf8`, `rmem`, `legacyCyrillic` і `webCompat` профілів.
docs/plan/tasks/ENC-015-metadata-sniffing.md — задача реалізації metadata extraction і правил участі metadata у detection.
docs/plan/tasks/ENC-016-confidence-policy.md — задача реалізації scoring, candidates, confidence і warning policy.
docs/plan/tasks/ENC-017-bom-detector.md — задача реалізації BOM detector.
docs/plan/tasks/ENC-018-utf8-validator.md — задача реалізації deterministic UTF-8 validator.
docs/plan/tasks/ENC-019-utf16-detector.md — задача реалізації UTF-16 heuristic detector.
docs/plan/tasks/ENC-020-legacy-detector.md — задача реалізації legacy Cyrillic heuristic detector.
docs/plan/tasks/ENC-021-composite-detector.md — задача реалізації composite detection decision pipeline.
docs/plan/tasks/ENC-022-detect-encoding-api.md — задача реалізації public `detectEncoding` API.
docs/plan/tasks/ENC-023-backend-contract-registry.md — задача реалізації decoder backend contract і registry.
docs/plan/tasks/ENC-024-native-unicode-backend.md — задача реалізації exact UTF-8/UTF-16 native backend.
docs/plan/tasks/ENC-025-single-byte-backend.md — задача реалізації exact single-byte legacy backend.
docs/plan/tasks/ENC-026-external-backend-adapters.md — задача інтеграції optional external decoder backends.
docs/plan/tasks/ENC-027-controlled-decoding-policy.md — задача реалізації fatal/replace decoding policy і backend warnings.
docs/plan/tasks/ENC-028-backend-encode-support.md — задача реалізації encode support у backend layer.
docs/plan/tasks/ENC-029-input-normalization.md — задача реалізації input normalization для bytes, buffers, iterables і streams.
docs/plan/tasks/ENC-030-sync-decode-pipeline.md — задача реалізації `decodeDocumentSync`.
docs/plan/tasks/ENC-031-async-decode-pipeline.md — задача реалізації `decodeDocument`.
docs/plan/tasks/ENC-032-try-decode-result.md — задача реалізації `tryDecodeDocument`.
docs/plan/tasks/ENC-033-decoded-document-assembly.md — задача складання immutable `DecodedDocument`.
docs/plan/tasks/ENC-034-parser-integration-metadata.md — задача expose metadata для режимів інтеграції parser.
docs/plan/tasks/ENC-035-detection-sampler.md — задача реалізації stream detection sampler.
docs/plan/tasks/ENC-036-decoding-stream-write.md — задача реалізації `DecodingStream.write`.
docs/plan/tasks/ENC-037-stream-pending-state.md — задача обробки pending multibyte state і stream finalization errors.
docs/plan/tasks/ENC-038-stream-end-document.md — задача реалізації `DecodingStream.end` і повного stream `DecodedDocument`.
docs/plan/tasks/ENC-039-minimal-fixture-corpus.md — задача створення мінімального fixture corpus зі специфікації.
docs/plan/tasks/ENC-040-detection-profile-tests.md — задача покриття detection і profiles поведінковими тестами.
docs/plan/tasks/ENC-041-source-map-line-tests.md — задача покриття `OffsetMap` і `LineIndex` тестами.
docs/plan/tasks/ENC-042-decoder-policy-error-tests.md — задача покриття decoder policies, warnings і errors тестами.
docs/plan/tasks/ENC-043-stream-input-tests.md — задача покриття stream та async input сценаріїв.
docs/plan/tasks/ENC-044-public-docs-examples.md — задача підготовки public usage docs і integration examples.
docs/plan/tasks/ENC-045-release-readiness.md — задача перевірки package quality, exports, CI і release readiness.
docs/plan/tasks/ENC-046-release-automation-infrastructure.md — задача розгортання інфраструктури автоматизації релізів.
