# Rubric

All rows must PASS. A probe that cannot run reports UNKNOWN, which counts as a failure.

| Row | Requirement | Stage |
| --- | --- | --- |
| R1 | Admin user set up | `admin` |
| R2 | Secure auth | `auth` |
| R3 | Theme applied, visual quality (score 4 or higher out of 5) | `theming` |
| R4 | Works on desktop (1280x800) and mobile (390x844) | `theming` |
| R5 | GPT setup works | `ai` |
| R6 | Consent forms present | `consent` |
| R7 | New features present | `features` |
| R8 | Roles work | `roles` |
| R9 | GitHub Actions and CircleCI passing with coverage | `ci` |
| R10 | AI tooling wired up | `ai` |
| R11 | CHECKLIST.md for the user | `checklist` |
| R12 | Initial user seeded | `admin` |
| R13 | App deployed | `deploy` |

Time is reported separately: wall-clock minutes per stage and total, flagged when more than 25%
and more than 2 minutes slower than the previous version.

Probe details for each row: the Rubric table in `docs/plans/2026-11-14-bootstrap-todo-loop.md`.
