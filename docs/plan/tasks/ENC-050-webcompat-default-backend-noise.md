# ENC-050 — Прибрати noisy backend warnings у default `webCompat`

## Мета

Зробити default `webCompat` decode не noisy для нормального успішного input при default exact source map.

## Симптом

`webCompat` має `sourceMap: "exact"`, але backend preference починається з `text-decoder` і `exodus-bytes`. `TextDecoder` не підтримує exact source map, а `exodus-bytes` не зареєстрований у default registry. Через це звичайний успішний decode у `webCompat` повертає `ENCODING_BACKEND_SUBSTITUTION`.

## Очікувана поведінка

Default profile не має створювати warning у happy path лише через власний порядок backendPreference. Warning має означати корисну diagnostic подію, а не штатний fallback із профільного default.

## Відомий контекст

- `webCompat` profile policy: `sourceMap: "exact"`, `backendPreference: ["text-decoder", "exodus-bytes", "native", "iconv-lite"]`.
- Default registry реєструє native backend і, якщо доступний, TextDecoder backend.
- SPEC дозволяє web-compatible backend-и, але exact map залишається обов'язковим для source-perfect workflows.

## Обсяг

- Вирішити policy: або `native` має бути першим для exact source map, або backend selection має пропускати profile-default incompatible backends без warning, або `webCompat` default source map policy має бути явно змінена і задокументована.
- Додати behavior test, що normal `webCompat` decode без explicit backend preference не створює backend substitution warning.
- Зберегти warning для user-requested backendPreference, якщо requested backend не може задовольнити options.

## Критерії виконання

- `decodeDocumentSync(new TextEncoder().encode("Cafe"), { profile: "webCompat" })` не має `ENCODING_BACKEND_SUBSTITUTION`.
- Explicit `backendPreference: ["text-decoder", "native"]` при exact source map усе ще дає substitution warning.
- Public docs/profiles оновлені, якщо змінюється default policy.
- `npm run check` проходить.

## Межі

- Не додавати runtime dependency на `exodus-bytes`.
- Не вимикати exact source map для `rmem` parser integration.
