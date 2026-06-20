# ENC-049 — Stream backend warning propagation на `end()`

## Мета

Забезпечити parity між stream API і sync decode для backend selection warnings, включно з empty stream і finalization paths.

## Симптом

`DecodingStream` зберігає backend warnings у pending state і додає їх тільки під час decoding chunk-а. Якщо stream завершується без decoded chunks, наприклад `createDecodingStream({ backendPreference: ["text-decoder", "native"] }).end()`, warning `ENCODING_BACKEND_SUBSTITUTION` губиться, хоча sync decode порожнього `Uint8Array` його повертає.

## Очікувана поведінка

Stream `DecodedDocument.warnings` має містити backend selection warnings незалежно від того, чи були decoded chunks. Fatal finalization errors також не мають губити вже відомі warnings.

## Відомий контекст

- `#pendingBackendWarnings` споживається через `#consumeBackendWarnings()` тільки в `#decodeChunk`.
- `end()` збирає document warnings із `#decodedChunks.flatMap((chunk) => chunk.warnings)`.
- Empty stream вже підтримується як valid empty document, тому warning propagation має працювати і для empty result.

## Обсяг

- Винести stream-level warning accumulator або явно додавати pending backend warnings у `end()`.
- Перевірити empty stream, stream з delayed detection, stream з backend substitution і finalization failure.
- Зберегти відсутність дублювання warnings для першого decoded chunk.

## Критерії виконання

- Empty stream warnings відповідають sync decode warnings для тих самих options.
- Backend substitution warning не губиться, якщо decoded chunks немає.
- Fatal `ENCODING_INCOMPLETE_STREAM_SEQUENCE` зберігає вже відомі stream warnings, якщо вони були.
- `npm run check` проходить.

## Межі

- Не змінювати public `DecodedChunk` contract.
- Не повертати chunk тільки заради warning без decoded text.
