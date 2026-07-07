# Release automation

Release automation for `@relicmem/encoding` is built on npm scripts and GitHub Actions without
third-party release tooling. It does not change the version by itself: the version must be recorded
in `package.json` by a separate reviewed commit, and the workflow input `version` is a confirmation
guard that must match package metadata.

## Local Scripts

- `npm run release:preview` - checks release inputs and runs `npm pack --dry-run --json`; package
  contents must include the build entrypoint/type declarations, `LICENSE`, `README.md`, `NOTICE`,
  and `package.json`; contents must not include source, tests, docs, fixtures, repository
  governance docs, or automation scripts.
- `npm run release:check` - runs the `release input` guard, the full `npm run check`, and package
  preview.
- `npm run release:pack` - creates `release-artifacts/*.tgz` only after the same package preview
  validation.
- `npm run release:publish` - publishes the verified tarball from `release-artifacts`; the command
  works only with `RELEASE_MODE=publish` and an npm token in `NODE_AUTH_TOKEN` or `NPM_TOKEN`.

PowerShell preview example for an already updated version:

```powershell
$env:RELEASE_VERSION = "0.0.2"
npm run release:check
```

`RELEASE_MODE` defaults to `preview`, and `NPM_TAG` defaults to `latest`. Publish mode blocks the
placeholder version `0.0.0` and prerelease versions with the `latest` dist-tag.

## Package Contents Policy

The npm package is intentionally smaller than the repository. The release preview guard requires:

- `dist/index.js` and `dist/index.d.ts` as the runtime entrypoint and type declarations;
- `package.json`;
- `README.md` and `LICENSE`, which npm includes as package metadata;
- `NOTICE`, which is explicitly listed in `package.json` `files` because it carries third-party
  notices and provenance required by the embedded encoding data.

Repository governance documents are not runtime package contents. `CONTRIBUTING.md`, `SECURITY.md`,
and `TRADEMARKS.md` remain in the source repository where GitHub and contributors can find the
current process, but they are blocked by release preview validation if a future packaging change
accidentally adds them to the npm tarball.

`documentation/*` is also repository-only. Public package users should receive the concise README
and the packaged `NOTICE`; maintainers can update long-form documentation independently of npm
runtime contents.

## GitHub workflow

Workflow `.github/workflows/npm-release.yml` runs only manually through `workflow_dispatch`.
Inputs:

- `mode`: `preview` or `publish`;
- `version`: the version that must already be in `package.json`;
- `npm_tag`: npm dist-tag for publish mode.

Job `package-preview` runs:

1. `npm ci`;
2. `npm run release:check`;
3. `npm run release:pack`;
4. upload `release-artifacts/*.tgz` as a GitHub artifact.

Job `publish` runs only for `mode=publish`, after the preview job, in the protected GitHub
environment `npm-release`. It reuses the verified artifact, checks that the npm version, GitHub
release, and Git tag do not exist yet, publishes the tarball through `npm publish --provenance`,
and then creates a GitHub release with notes from `documentation/release-notes-v1.md`.

## Secrets, Permissions, and Branch Policy

- `NPM_TOKEN` must be a GitHub environment secret for `npm-release`.
- Environment `npm-release` should have required reviewers; this is the manual confirmation for a
  real publication.
- Publish mode is allowed only from the repository default branch.
- Preview job has only `contents: read`.
- Publish job has `contents: write` for GitHub release/tag and `id-token: write` for npm
  provenance.
- GitHub private vulnerability reporting is the supported security intake channel and should remain
  enabled before a public release is accepted.

## Release notes

The current reproducible source for release notes is `documentation/release-notes-v1.md`. Before
each production release, this file or a future changelog should be updated in the same reviewed
commit as the package version.

## Recovery

- If `package-preview` fails, external state is unchanged: fix the commit and run the workflow
  again.
- If publish preflight fails, check the existing npm version, tag, or GitHub release; the workflow
  has not published the package.
- If `npm publish` fails, the GitHub release has not been created yet. Check npm logs, token,
  provenance permissions, and rerun the workflow after the fix.
- If npm publish succeeds but GitHub release creation fails, do not publish the package again.
  Create a GitHub release manually for `v<version>` with notes from
  `documentation/release-notes-v1.md` and attach the tarball artifact from the failed run.
- If the wrong npm dist-tag was applied to the correct version, fix it with
  `npm dist-tag add` / `npm dist-tag rm`.
- If the wrong version has already been published, do not rely on unpublish as the normal recovery
  path; prepare a patch release or npm deprecation depending on the actual impact.
