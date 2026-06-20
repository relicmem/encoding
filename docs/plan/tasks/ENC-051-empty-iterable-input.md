# ENC-051 — Empty iterable input має декодуватися як empty document

## Мета

Узгодити поведінку порожніх byte inputs між `Uint8Array`, iterable, async iterable і stream API.

## Симптом

Порожній `Uint8Array` декодується в empty document, і `createDecodingStream().end()` теж повертає empty document. Але порожній sync iterable або async iterable кидає `RangeError: Encoding byte input must contain at least one chunk.`

## Очікувана поведінка

Порожній byte input незалежно від container shape має створювати empty `DecodedDocument` із валідним empty `SourceBuffer`, empty `OffsetMap`, `LineIndex` з одним порожнім рядком і deterministic detection fallback/UTF-8 behavior.

## Відомий контекст

- `ByteChunkCollector.finish()` забороняє `chunksValue.length === 0`.
- `SourceBuffer` і stream path уже можуть працювати з нульовою довжиною bytes.
- Поточна поведінка залежить від форми input, а не від фактичного byte content.

## Обсяг

- Дозволити empty iterable/async iterable/readable stream як valid byte input.
- Переконатися, що chunk boundaries і sample snapshots не ламаються для empty collection.
- Додати regression tests для sync iterable, async iterable і `ReadableStream`, якщо runtime test environment підтримує його.

## Критерії виконання

- `decodeDocumentSync([])` повертає empty document.
- `decodeDocument(emptyAsyncIterable)` повертає empty document.
- Empty iterable result узгоджений із `decodeDocumentSync(new Uint8Array())`.
- `npm run check` проходить.

## Межі

- Не дозволяти non-Uint8Array chunks.
- Не змінювати string input synthetic byte behavior.
