# Release automation

Release automation для `@rmem/encoding` побудована на npm scripts і GitHub Actions без
стороннього release tooling. Вона не змінює version сама: версія має бути зафіксована в
`package.json` окремим reviewed commit, а workflow input `version` є confirmation guard і має
збігатися з package metadata.

## Локальні scripts

- `npm run release:preview` — перевіряє release inputs і запускає `npm pack --dry-run --json`;
  package contents мають містити build entrypoint/type declarations і не містити source, tests,
  docs, fixtures або automation scripts.
- `npm run release:check` — запускає `release input` guard, повний `npm run check` і package
  preview.
- `npm run release:pack` — створює `.release/*.tgz` тільки після тієї самої package preview
  validation.
- `npm run release:publish` — публікує єдиний `.release/*.tgz`; команда працює лише з
  `RELEASE_MODE=publish` і npm token у `NODE_AUTH_TOKEN` або `NPM_TOKEN`.

Приклад PowerShell preview для вже оновленої версії:

```powershell
$env:RELEASE_VERSION = "0.1.0"
npm run release:check
```

`RELEASE_MODE` за замовчуванням дорівнює `preview`, а `NPM_TAG` — `latest`. Publish mode блокує
placeholder version `0.0.0` і prerelease versions із `latest` dist-tag.

## GitHub workflow

Workflow `.github/workflows/release.yml` запускається тільки вручну через `workflow_dispatch`.
Inputs:

- `mode`: `preview` або `publish`;
- `version`: версія, яка вже має бути в `package.json`;
- `npm_tag`: npm dist-tag для publish mode.

Job `package-preview` виконує:

1. `npm ci`;
2. `npm run release:check`;
3. `npm run release:pack`;
4. upload `.release/*.tgz` як GitHub artifact.

Job `publish` запускається тільки для `mode=publish`, після preview job, у protected GitHub
environment `npm-release`. Він повторно бере verified artifact, перевіряє, що npm version,
GitHub release і Git tag ще не існують, публікує tarball через `npm publish --provenance`, а
потім створює GitHub release з notes із `documentation/release-notes-v1.md`.

## Secrets, permissions і branch policy

- `NPM_TOKEN` має бути GitHub environment secret для `npm-release`.
- Environment `npm-release` має мати required reviewers; це ручне підтвердження для реальної
  публікації.
- Publish mode дозволений тільки з default branch репозиторію.
- Preview job має лише `contents: read`.
- Publish job має `contents: write` для GitHub release/tag і `id-token: write` для npm
  provenance.

## Release notes

Поточне відтворюване джерело release notes — `documentation/release-notes-v1.md`. Перед кожним
production release цей файл або майбутній changelog має бути оновлений у тому самому reviewed
commit, що й package version.

## Recovery

- Якщо падає `package-preview`, зовнішній стан не змінено: виправити commit і запустити workflow
  знову.
- Якщо падає publish preflight, перевірити existing npm version, tag або GitHub release; workflow
  не публікував пакет.
- Якщо `npm publish` впав, GitHub release ще не створюється. Перевірити npm logs, token,
  provenance permissions і повторити workflow після виправлення.
- Якщо npm publish успішний, але GitHub release creation впав, не публікувати пакет повторно.
  Створити GitHub release вручну для `v<version>` з notes із `documentation/release-notes-v1.md`
  і прикріпити tarball artifact із failed run.
- Якщо помилковий npm dist-tag застосовано до правильної версії, виправити через
  `npm dist-tag add` / `npm dist-tag rm`.
- Якщо помилкова версія вже опублікована, не покладатися на unpublish як нормальний recovery
  path; підготувати patch release або npm deprecation залежно від фактичного впливу.
