# Terreno Loop plugin for Claude Code

Goal-driven loops for Claude Code. Give it an outcome an agent can measure on its own,
such as CI wall time, bundle size, or lint count, and it charters the goal, finds the work,
slices it into pull requests, and re-measures after each one lands until the metric hits
target or the budget runs out. Each slice goes through the `terreno` lifecycle plugin, so
install that plugin too.

Reference: https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/scan-plugin.md

## Install

Pick one channel and register only that one. Each channel provides a plugin named
`terreno-loop`, so two channels give duplicate commands.

Latest stable release, installed from npm as `@terreno/agent-plugin-loop`:

```text
/plugin marketplace add https://raw.githubusercontent.com/TerrenoLabs/terreno/master/plugins/claude-release/.claude-plugin/marketplace.json
/plugin install terreno-loop@terreno-releases
```

Every merge to `master`:

```text
/plugin marketplace add TerrenoLabs/terreno
/plugin install terreno-loop@terreno-plugins
```

One release, pinned: add `TerrenoLabs/terreno#<version>` as the marketplace instead.

Then run `/terreno-loop:run <goal>`. Claude Code does not auto-update third-party marketplaces by
default; run `/plugin update terreno-loop@<marketplace>` to pick up a new release.

## What you get

| Command | Does |
| --- | --- |
| `/terreno-loop:1-aim` | Charter the goal: metric, baseline, rules, budget |
| `/terreno-loop:2-sweep` | Run the rules and map parallel workers into candidate findings |
| `/terreno-loop:3-sift` | Dedupe, verify, and rank findings |
| `/terreno-loop:4-plot` | Slice findings into PR-sized plans |
| `/terreno-loop:5-track` | Re-measure the metric and choose the next move |
| `/terreno-loop:campaign` | Run bounded rounds, stopping at each gate |
| `/terreno-loop:run` | Stay resident: keep the goal moving and tend every open PR |

Loops can run for hours and use many tokens. Set a budget or stop condition in the charter.

## Maintainers

This directory is generated. Do not hand-edit it; run `bun run skills:sync`.

Claude Code resolves a plugin skill's command from the frontmatter `name`, so the
shortened names live here instead of in the shared skill files. Cursor, Codex, and
`npx skills` keep the canonical names from `plugins/terreno-loop/`.

| Source | Owns |
| --- | --- |
| `plugins/terreno-loop/skills/` | Aim, Sweep, Sift, Plot, Track, and the outer loops |
| `plugins/terreno-loop/references/` | Scan contract, map-reduce, goal tracking, schemas |
