# Install agent skills

Terreno's agent skills live in their own repository,
[TerrenoLabs/terreno-skills](https://github.com/TerrenoLabs/terreno-skills). Install them
into another repo or agent with the skills CLI:

```bash
npx skills add TerrenoLabs/terreno-skills
npx skills add TerrenoLabs/terreno-skills --skill terreno-1-grow
```

The first command opens a picker grouped by bundle. To install one part of Terreno, name
its bundle:

| Bundle | What you get |
| --- | --- |
| `lifecycle` | PRD, Grow → Pick ⇄ Roast → Brew → Taste, and the Pick-Roast, planning, and taste-sweep loops |
| `scan` | Goal-driven code scans: Aim → Sweep → Sift → Plot → Track, plus the campaign and resident loops |
| `app` | Backend, UI, light/dark mode, data, schema, admin, and test conventions for Terreno apps |
| `ship` | UI verification, PR evidence, docs, releases, upgrades, store assets, GCP deploys |
| `design` | Claude design handoff to a Terreno plan and Linear work |
| `dx` | Debug over MCP, test setup and writing, regression and user-guide backfills, MCP servers, social login |

```bash
npx skills add TerrenoLabs/terreno-skills --skill lifecycle --skill app
```

The [terreno-skills README](https://github.com/TerrenoLabs/terreno-skills#readme) lists
every skill in each bundle.

## Install as a host plugin

One plugin carries the lifecycle, scan, and app skills. Stage names differ by host because
Claude Code takes a plugin skill's command from the frontmatter `name`.

| Host | Plugin | Invoke Grow | Invoke Aim |
| --- | --- | --- | --- |
| Cursor | `terreno-planning` | `/terreno-1-grow` | `/terreno-scan-1-aim` |
| Codex | `terreno-planning` | `$terreno-1-grow` | `$terreno-scan-1-aim` |
| Claude Code | `terreno` | `/terreno:1-grow` | `/terreno:scan-1-aim` |

### Claude Code

```text
/plugin marketplace add TerrenoLabs/terreno-skills
/plugin install terreno@terreno-plugins
/terreno:1-grow
```

Each bundle is also its own plugin (`terreno-lifecycle`, `terreno-app`, `terreno-dx`, …)
for installing one part. Install the whole `terreno` plugin or bundle plugins, not both.

Claude Code does not auto-update third-party marketplaces by default. Run
`/plugin update terreno@terreno-plugins`, or turn on auto-update for the marketplace in
`/plugin` → **Marketplaces**.

### Codex

```text
codex plugin marketplace add TerrenoLabs/terreno-skills
codex plugin install terreno-planning --source terreno-plugins
$terreno-1-grow
```

### Cursor

Install `terreno-planning` from the terreno-skills Cursor marketplace, then invoke
`/terreno-1-grow`.

Cursor and Claude Code also load the bundled `pre-commit` and `ui-verifier` agents. Codex
loads the skills but does not currently expose plugin-defined agents.

## Expo skills

Expo's own skills (`upgrading-expo`, `expo-deployment`, `expo-dev-client`,
`expo-cicd-workflows`, `expo-api-routes`, `use-dom`) come from upstream:

```bash
npx skills add expo/skills
```

## Change a skill

Edit framework skills in the terreno-skills repository and open the pull request there.
This repository keeps only its own repository-only skills (release, roadmap, issue, and
maintenance workflows) in `.rulesync/skills/`; `bun run rules` generates the per-agent
copies. Package-specific guidance stays in `<package>/.ai/skills/` and
`<package>/.ai/guidelines/`, which the MCP server bundles.

## Keep native hooks in sync

Repository-level hooks are canonical in `.rulesync/hooks.json`; shared commands live in
`.rulesync/hooks/`. Run `bun run rules` after either changes. Rulesync generates the
native stop-hook configuration for Cursor, Claude Code, GitHub Copilot, and Devin. The
committed quality hook runs both `bun run lint` and `bun run compile` before
an agent finishes.

## Write human docs with the skills

Skills read architecture docs before changing code. After a user-visible or architectural
change, update `docs/` in the same slice using `update-docs`. See
[lifecycle plugin](../reference/lifecycle-plugin.md) and the
[documentation contract](https://github.com/TerrenoLabs/terreno-skills/blob/master/plugins/terreno-planning/references/documentation-contract.md).
