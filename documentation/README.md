# `@relicmem/encoding` Documentation

This directory contains practical public documentation. `docs/SPEC.md` remains the architectural
specification; the files here describe how to integrate the library safely.

## For Users

- [Getting started](getting-started.md) - the shortest path to the decode, detect-only, encode, and
  stream APIs.
- [API reference](api.md) - core functions, options, encode helpers, and expected result shape.
- [Encoding profiles](profiles.md) - when to use `relicmem`, `strictUtf8`,
  `legacyCyrillic`, and `webCompat`.
- [Source mapping and diagnostics](source-mapping-and-diagnostics.md) - `OffsetMap`,
  `LineIndex`, warnings/errors, and the string input caveat.
- [Parser integration](parser-integration.md) - the contract for `@relicmem/md-parser` without
  internal imports.
- [Encoding data provenance](encoding-data-provenance.md) - source URLs, audit date, and review
  rules for embedded labels and mapping tables.
- [Release notes v1 candidate](release-notes-v1.md) - compatibility, public API, dependency
  footprint, and known limitations before v1 delivery.
- [Release automation](release-automation.md) - GitHub workflow, npm scripts, publish gate,
  secrets, and recovery steps.
- [Contributor notes](contributors.md) - contributor rules, including runtime message language.

## For Agents

- [Agent reference](agents.md) - a single reference with key contracts, scenarios, and
  constraints for automated work.

## Example Verification

Documentation examples are backed by `tests/public-docs-examples.test.ts`.
When the public API changes, update the documentation and this test in the same change set.
