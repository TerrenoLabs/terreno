---
name: update-agent-docs
description: >-
  Write or revise skills, AGENTS.md, CLAUDE.md, and agent-facing rules with
  reliable triggers, progressive disclosure, explicit completion criteria, and
  one source of truth.
---
# Update agent documents

Use this workflow for any document consumed by an agent. When editing a skill, also read [`references/skill-mechanics.md`](references/skill-mechanics.md).

## 1. Find the source of truth

Identify generated copies before editing. In Terreno, `.rulesync/` is the source for
repository-only synchronized rules and skills; `bun run rules` generates tool-specific
copies. Agent lifecycle hooks are canonical in `.rulesync/hooks.json` with commands
under `.rulesync/hooks/`; the same command generates each tool's native hook config.
Reusable lifecycle and Terreno app skills live in the
[TerrenoLabs/terreno-skills](https://github.com/TerrenoLabs/terreno-skills) repository; change
them there, not here. Package skills under `<package>/.ai/skills/` serve
package/MCP tooling and are separate from the terreno-skills set.

Read related documents and remove conflicting duplicates rather than adding another layer. Human-facing docs (`docs/`) remain the architecture source; agent docs point at them and do not invent a second design.

## 2. Design the context pointer

The description or always-loaded rule line must say:

- what the document provides
- each genuinely distinct trigger branch

Front-load trigger words. Collapse synonyms that describe the same branch. Keep the pointer short because it spends context on every turn.

Choose model invocation only when the agent or another skill must discover the skill automatically. Otherwise set `disable-model-invocation: true`.

## 3. Write the workflow

Put ordered actions first. Every step ends in a checkable completion criterion. Use demanding bounds such as “every changed package accounted for,” not vague bounds such as “review the changes.”

Keep reference material beside the concept it governs. Move branch-specific or long reference material into `references/` and link it at the exact decision point that requires it.

Use stable leading words—such as `tracer bullet`, `frontier`, or `red`—to anchor repeated behavior. State the positive target; reserve prohibitions for hard guardrails.

## 4. Prune

For every sentence ask:

1. Does this change agent behavior?
2. Is this already discoverable cheaply from code/config?
3. Is the same meaning authoritative elsewhere?
4. Does this branch belong behind a reference pointer?

Delete no-ops, stale caches of the environment, and duplicate meanings.

## 5. Validate

- check frontmatter and relative links
- ensure referenced files and hook commands exist and are executable
- run `bun run rules` after `.rulesync/` edits
- run `bun run rules:check` and the repository's agent-quiet test command
- inspect the generated diff for unintended churn

The update is complete only when source and generated copies agree and every new pointer reaches an existing document.
