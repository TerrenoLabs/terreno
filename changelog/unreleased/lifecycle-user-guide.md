---
category: Added
---

The `terreno-planning` lifecycle plugin (2.14.0) grows an end-user guide with every feature:

- Every IP has a `## User guide` section listing the guide pages it adds, updates, or retires, or `None — <reason>`. Pages live in `docs/user-guide/<area>/<feature>.md`, one feature per page, with `title`, `audience`, `platforms`, and `questions` frontmatter that chat agents use to answer "how do I…" questions.
- Pick writes each page in the task that ships the feature, Roast checks it against the shipped screens, Brew gates on it and the index, and Taste keeps it current after fixes.
- A repo opts out with `| User guide | none — <reason> |` in a `## User guide conventions` table in AGENTS.md or CLAUDE.md.
- New `backfill-user-guide` skill drafts pages for features that shipped without one, one area at a time, and writes only the pages the human approves.
- `bun run check:user-guide` validates the pages and index (CI `repo-policies`); `--uncovered <app dir>` lists screens no page names.
- Terreno's own guide covers the example app's main features.
