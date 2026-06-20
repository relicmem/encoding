# Contributing to @rmem/encoding

Thank you for your interest in contributing to `@rmem/encoding`.

`@rmem/encoding` is part of the rmem project. The goal of this package is to provide reliable, well-tested, and predictable encoding-related functionality for the rmem ecosystem and for general TypeScript/JavaScript usage.

This project welcomes bug reports, documentation improvements, tests, compatibility fixes, and carefully scoped feature proposals.

## Project status

`@rmem/encoding` is in active development. Public APIs may still evolve before a stable `1.0.0` release.

Please keep contributions focused, explicit, and easy to review. Large rewrites, speculative abstractions, or broad architectural changes should start with an issue or discussion first.

## Ways to contribute

You can contribute by:

- reporting bugs;
- improving documentation;
- adding tests;
- improving compatibility with real-world encoded input;
- proposing support for additional encodings or detection strategies;
- reviewing pull requests;
- improving build, release, or CI workflows.

## Before opening a pull request

Before submitting a pull request, please make sure that:

- the change has a clear purpose;
- the scope is limited to one logical change;
- tests are added or updated when behavior changes;
- documentation is updated when public behavior changes;
- generated files, vendored data, or third-party materials are clearly identified;
- third-party license and notice requirements are preserved.

## Development setup

Use the package manager configured by the repository.

Typical workflow:

```bash
npm install
npm test
npm run build
npm run lint
```

If the repository uses another package manager or workspace layout, follow the scripts defined in `package.json`.

## Code style

Please follow the existing code style of the repository.

General expectations:

- TypeScript should be strict and explicit.
- Avoid `any` unless there is a strong reason and it is documented.
- Handle `undefined` values intentionally.
- Keep public APIs small, predictable, and well documented.
- Prefer simple data structures and measurable performance improvements over clever abstractions.
- Keep source files encoded as UTF-8.
- Do not introduce unnecessary runtime dependencies.

## Tests

Behavioral changes should include tests.

Tests should cover:

- valid input;
- invalid or malformed input;
- boundary conditions;
- streaming or chunked input, when relevant;
- compatibility cases derived from real-world data;
- regression cases for fixed bugs.

Performance-sensitive changes should avoid making claims without measurement. If a pull request changes hot paths, include a short note describing the expected performance impact and how it was evaluated.

## Encoding data and third-party materials

Encoding-related packages may depend on mapping tables, specifications, generated data, or compatibility references.

Do not add third-party source code, generated tables, copied specification text, or substantial derived data unless:

- the source is clearly identified;
- the license permits the intended use;
- required copyright notices are preserved;
- required notices are added to `NOTICE` when applicable;
- the generation process is documented when data is generated.

When in doubt, open an issue before adding third-party data.

## Commit messages

Use clear commit messages that describe the change.

Preferred format:

```text
area: short description
```

Examples:

```text
parser: handle empty byte input
encoding: add utf-8 bom detection
docs: clarify package scope
test: add malformed sequence cases
```

## Pull request guidelines

A good pull request should include:

- a clear description of the problem;
- a short explanation of the solution;
- tests for changed behavior;
- documentation updates when needed;
- notes about compatibility or migration impact, if any.

Please avoid mixing unrelated changes in one pull request.

## Licensing of contributions

This project is licensed under the Apache License, Version 2.0.

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in this project is submitted under the terms of the Apache License, Version 2.0, without any additional terms or conditions.

By contributing, you confirm that you have the right to submit your contribution and that it can be licensed under the Apache License, Version 2.0.

## Developer Certificate of Origin

By submitting a contribution, you certify that you wrote the contribution yourself or otherwise have the right to submit it to this project under its license.

If requested by maintainers, commits may need to include a sign-off line:

```text
Signed-off-by: Your Name <your.email@example.com>
```

You can add this automatically with:

```bash
git commit -s
```

## Security issues

Do not report security vulnerabilities in public issues.

Please follow the instructions in `SECURITY.md`.

## Code of conduct

Contributors are expected to communicate respectfully and constructively.

Technical disagreement is welcome. Personal attacks, harassment, spam, or intentionally disruptive behavior are not.
