# ENC-047 — Immutable options snapshot для detection pipeline

## Мета

Усунути можливість змінити поведінку detection/decoding через mutation об'єкта `options` після початкової нормалізації.

## Симптом

`decodeDocument`, `decodeDocumentSync`, `tryDecodeDocument`, `DetectionSampler` і `createDecodingStream` нормалізують options, але detection повторно читає початковий mutable object. Якщо iterable або async iterable змінює `options` під час збору chunks, виклик, який стартував із `profile: "strictUtf8"`, може завершитися legacy decoding.

## Очікувана поведінка

Публічний виклик має працювати з одним immutable normalized snapshot. Після входу в API caller не може змінити profile, allowed encodings, metadata, sample size, replacement policy або backend preference для поточного decode/stream instance.

## Відомий контекст

- `decodeNormalizedDocument` отримує normalized options, але byte pipeline передає в `detectCompositeEncoding` початкові `originalOptions`.
- `DetectionSampler` зберігає `#options` і використовує його під час `#commitDetectionFromSample`.
- Помилка порушує profile policy, зокрема fatal behavior `strictUtf8`.

## Обсяг

- Перевести detection pipeline на normalized detect/decode options або frozen raw snapshot без повторного читання caller-owned object.
- Зберегти webCompat label normalization, metadata sniffing і BOM priority без дублювання нормалізації.
- Додати regression tests для sync iterable, async iterable і stream scenario з mutation після старту API call.

## Критерії виконання

- Mutation початкового `options` після входу в API не змінює detection result.
- `strictUtf8` не може перейти в legacy profile через mutation під час iterable read.
- `decodeDocument`, `decodeDocumentSync`, `tryDecodeDocument`, `DetectionSampler` і `createDecodingStream` мають однакову snapshot semantics.
- `npm run check` проходить.

## Межі

- Не змінювати публічну форму options.
- Не додавати глобальний mutable registry або implicit process-wide profile state.
