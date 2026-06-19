# ENC-046 — Інфраструктура автоматизації релізів

## Мета

Розгорнути production-ready інфраструктуру автоматизації релізів для `@rmem/encoding`, щоб release process був відтворюваним, перевірюваним і не залежав від ручних локальних кроків.

## Обсяг

- Визначити release workflow: versioning, changelog/release notes, package build, test gates і publish gate.
- Налаштувати автоматизовану перевірку перед релізом: `check`, build artifacts, package exports і type declarations.
- Додати безпечний dry-run або preview режим для перевірки npm package contents без фактичної публікації.
- Зафіксувати вимоги до secrets, permissions і branch/tag policy для release workflow.
- Задокументувати ручні recovery steps для failed або partially completed release.

## Критерії виконання

- Release automation запускається від контрольованої події і не публікує пакет без проходження quality gates.
- Є перевірка package contents перед publish.
- Release notes або changelog формуються з відтворюваного джерела.
- Документація пояснює, які кроки автоматизовані, які лишаються ручними і чому.

## Межі

- Не публікувати реальний package release без окремого підтвердження користувача.
- Не додавати сторонній release tooling, якщо той самий результат можна отримати простішою стабільною конфігурацією.
- Не змішувати release automation із feature hardening: defects потрібно фіксувати через `E98 Відладка та багфікси`.
