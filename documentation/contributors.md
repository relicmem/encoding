# Нотатки для contributors

## Мова

Документація та коментарі в коді пишуться українською мовою.

Усі runtime messages, які генерує код для користувача, logs, CLI, errors або diagnostics,
мають бути англійською мовою. Це включає `EncodingError.message` і `EncodingWarning.message`.

## Приклади

Коли змінюється публічний API, оновлюйте:

- відповідний файл у `documentation/`;
- `documentation/agents.md`, якщо зміна впливає на агентські інструкції;
- `tests/public-docs-examples.test.ts`, щоб приклади компілювалися і перевіряли поведінку.

## Межа public API

Публічні приклади мають імпортувати з package root:

```ts
import { decodeDocument } from "@rmem/encoding";
```

Не документуйте internal detector/decoder/source classes як integration surface, якщо вони не
експортуються як стабільний public contract.

## Source-perfect behavior

Не підміняйте byte input string input-ом у прикладах для parser integration. String input
прийнятний для тестів, editor-only flows або already-decoded workflows, але не для exact source
ranges.
