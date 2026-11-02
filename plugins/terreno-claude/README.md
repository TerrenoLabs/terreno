# Terreno plugin for Claude Code

Terreno's agent lifecycle and app-building skills for Claude Code. Grow shapes a request
into an approved plan, Pick and Roast build and prove it one task at a time, Brew opens the
pull request, and Taste reacts to review and CI until it is mergeable. The plugin also ships
Terreno backend, UI, data, admin, docs, upgrade, and deployment skills, plus the
`pre-commit` and `ui-verifier` agents.

Reference: https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/lifecycle-plugin.md

## Install

Pick one channel and register only that one. Each channel provides a plugin named
`terreno`, so two channels give duplicate commands.

Latest stable release, installed from npm as `@terreno/agent-plugin`:

```text
/plugin marketplace add https://raw.githubusercontent.com/TerrenoLabs/terreno/master/plugins/claude-release/.claude-plugin/marketplace.json
/plugin install terreno@terreno-releases
```

Every merge to `master`:

```text
/plugin marketplace add TerrenoLabs/terreno
/plugin install terreno@terreno-plugins
```

One release, pinned: add `TerrenoLabs/terreno#<version>` as the marketplace instead.

Then run `/terreno:1-grow`. Claude Code does not auto-update third-party marketplaces by
default; run `/plugin update terreno@<marketplace>` to pick up a new release.

## What you get

| Command | Does |
| --- | --- |
| `/terreno:1-grow` | Research, clarify, and approve an implementation plan and task list |
| `/terreno:2-pick` | Build one task test-first, then roast it and pick the next |
| `/terreno:3-roast` | Independently prove or disprove the current task |
| `/terreno:4-brew` | Final checks, commit, push, open the PR, wait for CI and review bots |
| `/terreno:5-taste` | React to CI and review on the PR until it is mergeable |
| `/terreno:pick-roast-loop` | Work an approved plan through every task |

## Maintainers

This directory is generated. Do not hand-edit it; run `bun run skills:sync`.

Claude Code resolves a plugin skill's command from the frontmatter `name`, so the
shortened names live here instead of in the shared skill files. Cursor, Codex, and
`npx skills` keep the canonical names from `plugins/terreno-planning/`.

| Source | Owns |
| --- | --- |
| `plugins/terreno-planning/skills/` | Lifecycle and Terreno app workflows |
| `plugins/terreno-planning/agents/` | Reusable verification agents |
| `plugins/terreno-planning/references/` | Shared lifecycle references |
