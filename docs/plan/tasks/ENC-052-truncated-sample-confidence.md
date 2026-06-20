# ENC-052 — Confidence policy для truncated detection sample

## Мета

Прибрати misleading full-confidence detection, коли `detectEncoding` або stream sampler приймає рішення лише за truncated sample.

## Симптом

Якщо `sampleSizeBytes` менший за input, detector валідовує тільки sample bytes. Наприклад, `sampleSizeBytes: 1` може повернути `utf-8` з confidence `1` для input, де invalid UTF-8 sequence стоїть після першого byte. Факт `truncated` обчислюється, але не впливає на confidence, warnings або result details.

## Очікувана поведінка

Detection result має явно відображати, що рішення прийняте за sample, а не за повним input. Для truncated sample не можна мовчки заявляти full-document confidence `1`, якщо решта bytes не перевірена.

## Відомий контекст

- `createCompositeDetectionInputSample` повертає `truncated`, але pipeline його не використовує.
- Тести зараз фіксують, що `sampleSizeBytes: 1` у `strictUtf8` може повернути `utf8-validation` confidence `1`.
- Stream sampler також може фіксувати detection до повного input.

## Обсяг

- Визначити політику для sample-based confidence: warning, confidence cap, details у candidate/result або окремий sample metadata contract.
- Оновити tests, які зараз очікують full confidence на truncated sample.
- Перевірити вплив на `strictUtf8`, `rmem`, `legacyCyrillic` і stream detection.

## Критерії виконання

- Truncated sample detection не виглядає як повна валідація всього документа.
- Invalid bytes після sample boundary не створюють misleading `confidence: 1` без warning/metadata.
- Behavior задокументований у public detect/stream docs, якщо змінюється observable contract.
- `npm run check` проходить.

## Межі

- Не декодувати весь документ у detection-only API.
- Не ламати bounded sampling як performance feature.
