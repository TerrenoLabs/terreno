---
category: Changed
---

The repository's agent rules now generate with rulesync 17 (up from 9). The root rule `.rulesync/rules/00-root.md` now generates `AGENTS.md`, which Devin and other AGENTS.md readers load, in place of `.devin/rules/00-root.md`. Never edit `AGENTS.md` by hand: edit the root rule and run `bun run rules`. The examples that existed only in the old hand-edited `AGENTS.md` (syncdb and RTK SDK usage) moved into the root rule, so `CLAUDE.md`, the Cursor root rule, and Copilot instructions get them too. Links in the root rule now resolve from the repository root. Generated Copilot hooks use the portable `command` field. Generated Copilot subagents no longer list `agent/runSubagent` as their only tool, so they get every default tool. Generated skills carry their `license`, `disable-model-invocation`, and Devin `triggers` frontmatter.
