# Security Policy

## Supported Versions

All `@terreno/*` packages are versioned in lockstep. Security fixes are
published for the versions below.

| Version | Supported |
| ------- | --------- |
| 0.30.x (current minor) | Yes — full support |
| 0.29.x (previous minor) | Security fixes only |
| 0.28.x and older | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

### Primary channel: GitHub private vulnerability reporting

Use [GitHub private vulnerability reporting](https://github.com/TerrenoLabs/terreno/security/advisories/new)
for this repository. This is the preferred channel because it keeps details
private until a fix is ready.

### Fallback: email

If you cannot use GitHub's form, email **security@terreno.app** with:

- A description of the vulnerability and its impact
- Steps to reproduce, or a proof of concept if you have one
- Affected package(s) and version(s), if known

We will acknowledge receipt within **5 business days**. We may follow up for
more detail. We will notify you when a fix is released (or if we decline the
report, with an explanation).

## Automated Analysis

This repository runs [CodeQL](https://codeql.github.com/) static analysis on
`master` via `.github/workflows/codeql-analysis.yml` (on push and on a weekly
schedule). CodeQL findings are triaged alongside human reports; they do not
replace responsible disclosure from researchers.

## Coordinated Disclosure

We ask reporters to allow reasonable time for a fix before public disclosure.
We credit reporters in release notes when they want to be named.
