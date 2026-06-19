# ENC-044 — Public docs і examples

## Мета

Підготувати документацію використання, достатню для інтеграторів і майбутньої роботи над `@rmem/md-parser`.
Також зробити компактний та інформативний README.md в якому описати призначення та основні можливості бібліотеки а також зробити посилання на файли документації.
Файли документації потрібно розмістити в папці documentation. Причому має бути окремо документ документації для агентів і окремо гарно структуровані документи для людей.

## Обсяг

- Описати high-level decode, detect-only і stream APIs.
- Додати examples для `rmem`, `strictUtf8`, `legacyCyrillic`, `webCompat`.
- Документувати source map, line index, warnings/errors і string input caveat.
- Додати parser integration example зі SPEC.
- Два види документації, монолітний файл для агентів та структурований набір файлів для людей.

## Критерії виконання

- Приклади компілюються або перевіряються type tests.
- Документація пояснює, коли потрібен byte input замість string input.
- Runtime message language rule відображений для contributors.

## Межі

- Не створювати marketing landing page.
- Не дублювати всю SPEC як README без практичної структури.
