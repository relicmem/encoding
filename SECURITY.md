# Security Policy

## Supported versions

`@relicmem/encoding` is in active development.

Security fixes are generally provided for:

| Version                  | Supported   |
| ------------------------ | ----------- |
| Latest published release | Yes         |
| `main` branch            | Yes         |
| Older pre-1.0 releases   | Best effort |
| Deprecated releases      | No          |

Before `1.0.0`, the project may introduce breaking changes while the API is still being stabilized.

After `1.0.0`, this policy may be updated with a more explicit version support window.

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues, public discussions, or social media.

Preferred reporting method:

1. Open the repository on GitHub.
2. Go to the **Security** tab.
3. Use **Report a vulnerability** if private vulnerability reporting is enabled.

If private vulnerability reporting is not available yet, please open a minimal public issue asking for the preferred private security contact. Do not include exploit details, proof-of-concept code, crash inputs, or sensitive information in the public issue.

## What to include

A useful vulnerability report should include:

- affected package name and version;
- affected runtime environment;
- a clear description of the issue;
- steps to reproduce;
- minimal reproduction input, if safe to share privately;
- expected behavior;
- actual behavior;
- potential impact;
- whether the vulnerability is already public;
- whether you want public credit in the advisory.

## Scope

Security issues may include, but are not limited to:

- denial-of-service risks caused by malformed input;
- excessive CPU or memory usage on untrusted input;
- crashes caused by malformed byte sequences;
- unsafe handling of generated or external encoding data;
- dependency or supply-chain vulnerabilities;
- build, release, or provenance issues;
- behavior that could lead to data corruption in security-sensitive contexts.

The following are usually not considered security vulnerabilities by themselves:

- unsupported encodings;
- normal parsing or decoding errors;
- behavior that requires trusted local code execution;
- issues in unsupported versions;
- general bugs without a plausible security impact.

If you are unsure whether something is security-sensitive, report it privately.

## Response expectations

The maintainers will make a best effort to:

- acknowledge valid private reports;
- investigate the issue;
- avoid unnecessary public disclosure before a fix is available;
- credit the reporter when appropriate and requested;
- publish a patched release when a fix is ready;
- document relevant mitigation steps when possible.

This is a small open-source project, so response times may vary. Please act in good faith and avoid public disclosure before maintainers have had a reasonable opportunity to investigate and fix the issue.

## Coordinated disclosure

Please do not publicly disclose a vulnerability until:

- the maintainers have confirmed the issue;
- a fix or mitigation is available;
- users have had a reasonable opportunity to update;
- or disclosure has otherwise been coordinated with the maintainers.

## Security of dependencies and releases

Users are encouraged to:

- install packages from trusted registries;
- verify package names carefully;
- review changelogs before upgrading;
- keep dependencies up to date;
- avoid running untrusted input through privileged processes.

Official releases should be published through the configured project release process.
