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
| Cursor | `terreno-planning` | `/terreno-1-grow` | `terreno-loop` | `/terreno-loop-1-aim` |
| Codex | `terreno-planning` | `$terreno-1-grow` | `terreno-loop` | `$terreno-loop-1-aim` |
| Claude Code | `terreno` | `/terreno:1-grow` | `terreno-loop` | `/terreno-loop:1-aim` |

`terreno-loop` depends on the lifecycle plugin: Plot hands each slice to Grow. Its
resident loop (`/terreno-loop:run`, `/terreno-loop-run`, `$terreno-loop-run`) keeps a
goal running and heartbeats over the PRs it opens. See the
[scan plugin reference](../reference/scan-plugin.md).

### Cursor

Install `terreno-planning` from [`.cursor-plugin/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.cursor-plugin/marketplace.json), then invoke `/terreno-1-grow`.

### Codex

```text
codex plugin marketplace add TerrenoLabs/terreno
codex plugin install terreno-planning --source terreno-plugins
codex plugin install terreno-loop --source terreno-plugins
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
/plugin install terreno-loop@terreno-plugins
/terreno:1-grow
```

Marketplace: [`.claude-plugin/marketplace.json`](https://github.com/TerrenoLabs/terreno/blob/master/.claude-plugin/marketplace.json).
Claude Code stages, app skills, and agents come from the generated copy at
[`plugins/terreno-claude/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-claude);
scan stages come from
[`plugins/terreno-loop-claude/`](https://github.com/TerrenoLabs/terreno/tree/master/plugins/terreno-loop-claude).

#### Pick a channel

Register one channel. Each one provides plugins named `terreno` and `terreno-loop`, so
two channels give duplicate `/terreno:*` skills.

| Channel | Tracks | Add the marketplace | Install |
| --- | --- | --- | --- |
| Master | Every merge to `master` | `/plugin marketplace add TerrenoLabs/terreno` | `/plugin install terreno@terreno-plugins` |
| Pinned release | One release tag, frozen | `/plugin marketplace add TerrenoLabs/terreno#<version>` | `/plugin install terreno@terreno-plugins` |
| Latest release | The newest stable release, from npm | `/plugin marketplace add https://raw.githubusercontent.com/TerrenoLabs/terreno/master/plugins/claude-release/.claude-plugin/marketplace.json` | `/plugin install terreno@terreno-releases` |

The release channel installs `@terreno/agent-plugin` and `@terreno/agent-plugin-loop`
from npm. Both are published in lockstep with every other `@terreno/*` package, and
their plugin version is the Terreno release. To move a pinned install to another release, remove
the marketplace and add it again at the new tag. Only tags from 57.21.0 on carry
distinct plugin versions. Older tags all report `2.12.0`, so switching between two of
them can be skipped as already up to date.

Claude Code does not auto-update third-party marketplaces by default. Run
`/plugin update terreno@<marketplace>`, or turn on auto-update for the marketplace in
`/plugin` → **Marketplaces**.

## What you get

| Group | Skills |
| --- | --- |
| Lifecycle | `terreno-1-grow` … `terreno-5-taste`, `terreno-pick-roast-loop`, `terreno-planning-loop`, `terreno-taste-sweep` |
| Terreno apps | backend, UI, admin interfaces, data, schema, SDK, prompts, upgrades, deployment |
| Testing | `terreno-test-setup` (bootstrap backend, frontend, mobile), `terreno-backend-tests`, `terreno-frontend-tests`, `terreno-mobile-tests`, `backend-test-env`, `backfill-regression` (propose manual regression cases for approval) |
| Docs | `update-docs`, `backfill-user-guide` (draft end-user guide pages for approval), `update-agent-docs`, architecture skills |
| GitHub | issues, review, UI verification, PR screenshots (`attach-pr-media`), release, dependency updates |
| Code scans | `terreno-loop-1-aim` … `terreno-loop-5-track`, `terreno-loop-campaign`, `terreno-loop-run` |
| Expo and native | `track-upstream-expo`, `upgrading-expo`, `store-assets`, deployment / EAS skills |
| Plugin agents | `pre-commit`, `ui-verifier` |

`skills.sh.json` at the repo root groups those names on [skills.sh](https://skills.sh).
Cursor and Claude Code load the bundled plugin agents. Codex loads the combined skill
set but does not currently expose plugin-defined agents.

## Keep copies in sync (Terreno maintainers)

Canonical sources:

1. `plugins/terreno-planning/skills/` — lifecycle and reusable Terreno app workflows
2. `plugins/terreno-planning/agents/` — reusable verification agents
3. `plugins/terreno-loop/skills/` — scan stages and the campaign loop
4. `.rulesync/skills/` — repository-only and optional Expo skills (`bun run rules` generates agent copies)
5. `<package>/.ai/skills/` — package/MCP-specific copies; not installable overlays

`plugins/terreno-claude/` is generated from sources 1 and 2, and
`plugins/terreno-loop-claude/` from source 3, both with shortened skill names.
Codex uses the canonical plugin plus committed `.codex-plugin/plugin.json` and
`.agents/plugins/marketplace.json` — do not generate a third plugin tree.

Regenerate the installable tree and the Claude plugin:

```bash
bun run skills:sync
bun run check:lifecycle-skills
```

Do not hand-edit `skills/`.

A `.rulesync/skills/` skill that links a lifecycle reference as
`references/<name>.md` (for example `references/push-ownership.md`) gets its own copy of
`plugins/terreno-planning/references/<name>.md`, so the link still resolves once the skill
is installed elsewhere. `skills:sync` rewrites those copies and `skills:check` fails when
one drifts. Edit the plugin reference, never the copy, then run `bun run skills:sync` and
`bun run rules`.

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
