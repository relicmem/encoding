# Документація `@rmem/encoding`

Цей каталог містить практичну публічну документацію. `docs/SPEC.md` залишається
архітектурною специфікацією, а файли тут описують, як безпечно інтегрувати бібліотеку.

## Для людей

- [Швидкий старт](getting-started.md) — найкоротший шлях до decode, detect-only і stream API.
- [Довідник API](api.md) — основні функції, опції та очікувана форма результату.
- [Профілі кодування](profiles.md) — коли використовувати `rmem`, `strictUtf8`,
  `legacyCyrillic` і `webCompat`.
- [Source mapping і diagnostics](source-mapping-and-diagnostics.md) — `OffsetMap`,
  `LineIndex`, warnings/errors і caveat для string input.
- [Інтеграція parser](parser-integration.md) — контракт для `@rmem/md-parser` без internal
  imports.
- [Release notes v1 candidate](release-notes-v1.md) — сумісність, public API, dependency
  footprint і known limitations перед v1 delivery.
- [Release automation](release-automation.md) — GitHub workflow, npm scripts, publish gate,
  secrets і recovery steps.
- [Нотатки для contributors](contributors.md) — правила для contributors, включно з мовою
  runtime messages.

## Для агентів

- [Довідник для агентів](agents.md) — монолітний довідник із ключовими контрактами,
  сценаріями та обмеженнями для автоматизованої роботи.

## Перевірка прикладів

Приклади з документації підтримуються тестом `tests/public-docs-examples.test.ts`.
Під час зміни публічного API оновлюйте документацію і цей тест в одному наборі змін.
