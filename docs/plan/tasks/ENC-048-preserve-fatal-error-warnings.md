# ENC-048 — Preserve warnings у fatal `EncodingError`

## Мета

Зберігати попередні detection/backend warnings у fatal `EncodingError`, щоб parser integration не втрачала diagnostics при невдалому decoding.

## Симптом

Detection може створити warnings, наприклад `ENCODING_BOM_CONFLICT`, але якщо backend decode пізніше кидає `ENCODING_INVALID_SEQUENCE`, error повертається з порожнім `warnings`. Так само backend substitution warnings можуть загубитися, якщо fatal error виникає після backend selection.

## Очікувана поведінка

Fatal `EncodingError` має містити stable warnings, які вже були відомі до fatal failure: detection warnings, backend selection warnings і, де доречно, source map warnings.

## Відомий контекст

- `DecodeDocumentCore` додає warnings до `DecodedDocument` лише після успішного `backend.decode`.
- `NativeUnicodeBackend` rethrow-ить `mapResult.error` без збагачення warnings.
- `tryDecodeDocument` повертає той самий `EncodingError`, тому втрата warnings напряму впливає на no-throw diagnostics path.

## Обсяг

- Додати механізм збагачення `EncodingError` warnings без втрати code, ranges, details і cause.
- Покрити explicit/BOM conflict + invalid sequence.
- Покрити backend substitution + fatal backend/source-map failure.
- Перевірити `tryDecodeDocument` parity з throwing API.

## Критерії виконання

- Fatal decode після detection warning повертає `EncodingError.warnings` із цим warning.
- `tryDecodeDocument` повертає failure з тим самим набором warnings.
- Порядок warnings лишається stable і відповідає порядку виникнення.
- `npm run check` проходить.

## Межі

- Не перетворювати fatal errors на successful partial document.
- Не дублювати warnings у successful `DecodedDocument.warnings`.
