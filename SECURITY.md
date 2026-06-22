# Security Policy

## Supported versions

MApper is under active development. Security fixes are applied to the current
`main` branch only. There are no separately maintained release branches yet.

| Version        | Supported          |
| -------------- | ------------------ |
| `main` (current) | ✅ |
| older commits / tags | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report suspected vulnerabilities privately by email to **leo_frht@icloud.com**.
Include, where possible:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof of concept if available),
- affected component (frontend, backend, packaging) and version/commit.

We will acknowledge your report, investigate, and coordinate a fix and
disclosure timeline with you. Please allow reasonable time for a fix before any
public disclosure.

## Scope

MApper wraps third-party scientific software (Brightway2, premise) and uses the
separately licensed ecoinvent database, which users supply themselves.
Vulnerabilities in those upstream projects should be reported to their
respective maintainers; issues in MApper's own code (this repository) should be
reported here.
