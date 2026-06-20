# @relicmem/encoding

`@relicmem/encoding` — byte-to-text intake layer для `RelicMEM`-документів. Пакет визначає
кодування, декодує bytes за вибраною політикою, зберігає raw source bytes і повертає source
mapping data, на які можуть спиратися вищі parser layers.

Пакет не є Markdown parser. Його задача — дати `@relicmem/md-parser` та іншим інтеграторам
decoded document із:

- canonical encoding detection і confidence data;
- exact byte-to-text source maps там, де active profile цього вимагає;
- line index без нормалізації line endings;
- BOM, backend, warning і error metadata;
- stream-safe decoding для split multibyte sequences.

## Швидкий приклад

```ts
import { decodeDocument } from "@relicmem/encoding";

const decoded = await decodeDocument(bytes, {
  profile: "relicmem",
  sourceMap: "exact",
});

console.log(decoded.text);
console.log(decoded.detection.encoding);
console.log(decoded.lineIndex.positionAtTextOffset(0));
```

Використовуйте byte input (`Uint8Array`, `ArrayBuffer`, iterables або streams), коли важливі
source ranges. String input уже декодований; для нього створюються synthetic UTF-8 bytes, тому
він не є source-perfect.

## Документація

- [Індекс документації](documentation/README.md)
- [Швидкий старт](documentation/getting-started.md)
- [Довідник API](documentation/api.md)
- [Профілі кодування](documentation/profiles.md)
- [Source mapping і diagnostics](documentation/source-mapping-and-diagnostics.md)
- [Інтеграція parser](documentation/parser-integration.md)
- [Release notes v1 candidate](documentation/release-notes-v1.md)
- [Release automation](documentation/release-automation.md)
- [Нотатки для contributors](documentation/contributors.md)
- [Довідник для агентів](documentation/agents.md)

Приклади віддзеркалені в `tests/public-docs-examples.test.ts`, тому вони перевіряються
звичайними TypeScript і test gates.
