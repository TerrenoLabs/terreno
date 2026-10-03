# Install agent skills

Install Terreno's agent skills into another repo or agent with the skills CLI.

```bash
npx skills add TerrenoLabs/terreno
npx skills add TerrenoLabs/terreno --skill terreno-1-grow
```

That copies the committed `skills/` tree: lifecycle stages (Grow, Pick, Roast, Brew,
Taste), three outer loops, combined Terreno app workflows, and optional repository
skills.

## Install as a host plugin

Two plugins ship from this marketplace: the combined lifecycle and Terreno app workflows,
and the optional goal-driven scan plugin. Stage names differ by host because Claude Code
takes a plugin skill's command from the frontmatter `name`.

| Host | Plugin | Invoke Grow | Scan plugin | Invoke Aim |
| --- | --- | --- | --- | --- |
| Cursor | `terreno-planning` | `/terreno-1-grow` | `terreno-scan` | `/terreno-scan-1-aim` |
| Codex | `terreno-planning` | `$terreno-1-grow` | `terreno-scan` | `$terreno-scan-1-aim` |
| Claude Code | `terreno` | `/terreno:1-grow` | `terreno-scan` | `/terreno-scan:1-aim` |

`terreno-scan` depends on the lifecycle plugin: Plot hands each slice to Grow. Its
resident loop (`/terreno-scan:loop`, `/terreno-scan-loop`, `$terreno-scan-loop`) keeps a
goal running and heartbeats over the PRs it opens. See the
[scan plugin reference](../reference/scan-plugin.md).

### Cursor

Install `terreno-planning` from [`.cursor-plugin/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.cursor-plugin/marketplace.json), then invoke `/terreno-1-grow`.

### Codex

```text
codex plugin marketplace add TerrenoLabs/terreno
codex plugin install terreno-planning --source terreno-plugins
codex plugin install terreno-scan --source terreno-plugins
$terreno-1-grow
```

Marketplace: [`.agents/plugins/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.agents/plugins/marketplace.json).
Codex installs the canonical plugin at
[`plugins/terreno-planning/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-planning)
(`.codex-plugin/plugin.json`). A clone of this repo already exposes that marketplace.

### Claude Code

```text
/plugin marketplace add TerrenoLabs/terreno
/plugin install terreno@terreno-plugins
/plugin install terreno-scan@terreno-plugins
/terreno:1-grow
```

Marketplace: [`.claude-plugin/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.claude-plugin/marketplace.json).
Claude Code stages, app skills, and agents come from the generated copy at
[`plugins/terreno-claude/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-claude);
scan stages come from
[`plugins/terreno-scan-claude/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-scan-claude).

## What you get

| Group | Skills |
| --- | --- |
| Lifecycle | `terreno-1-grow` … `terreno-5-taste`, `terreno-pick-roast-loop`, `terreno-planning-loop`, `terreno-taste-sweep` |
| Terreno apps | backend, UI, admin interfaces, data, schema, SDK, prompts, upgrades, deployment |
| Docs | `update-docs`, `update-agent-docs`, architecture skills |
| GitHub | issues, review, UI verification, release, dependency updates |
| Code scans | `terreno-scan-1-aim` … `terreno-scan-5-track`, `terreno-scan-campaign`, `terreno-scan-loop` |
| Expo and native | `track-upstream-expo`, `upgrading-expo`, `store-assets`, deployment / EAS skills |
| Plugin agents | `pre-commit`, `ui-verifier` |

`skills.sh.json` at the repo root groups those names on [skills.sh](https://skills.sh).
Cursor and Claude Code load the bundled plugin agents. Codex loads the combined skill
set but does not currently expose plugin-defined agents.

## Keep copies in sync (Terreno maintainers)

Canonical sources:

1. `plugins/terreno-planning/skills/` — lifecycle and reusable Terreno app workflows
2. `plugins/terreno-planning/agents/` — reusable verification agents
3. `plugins/terreno-scan/skills/` — scan stages and the campaign loop
4. `.rulesync/skills/` — repository-only and optional Expo skills (`bun run rules` generates agent copies)
5. `<package>/.ai/skills/` — package/MCP-specific copies; not installable overlays

`plugins/terreno-claude/` is generated from sources 1 and 2, and
`plugins/terreno-scan-claude/` from source 3, both with shortened skill names.
Codex uses the canonical plugin plus committed `.codex-plugin/plugin.json` and
`.agents/plugins/marketplace.json` — do not generate a third plugin tree.

Regenerate the installable tree and the Claude plugin:

```bash
bun run skills:sync
bun run check:lifecycle-skills
```

Do not hand-edit `skills/`.

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
[documentation contract](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/documentation-contract.md).
