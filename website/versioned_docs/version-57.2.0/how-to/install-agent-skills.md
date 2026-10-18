# Install agent skills

Install Terreno's agent skills into another repo or agent with the skills CLI.

```bash
npx skills add TerrenoLabs/terreno
npx skills add TerrenoLabs/terreno --skill terreno-1-grow
```

That copies the committed `skills/` tree: lifecycle stages (Grow, Pick, Roast, Brew,
Taste), repository skills, and published package skills.

## What you get

| Group | Skills |
| --- | --- |
| Lifecycle | `terreno-1-grow` … `terreno-5-taste` |
| Terreno apps | backend, UI, data, schema, SDK |
| Docs | `update-docs`, `update-agent-docs`, architecture skills |
| GitHub | commit, PR, review, verify, release, deploy |

`skills.sh.json` at the repo root groups those names on [skills.sh](https://skills.sh).

## Keep copies in sync (Terreno maintainers)

Canonical sources:

1. `.rulesync/skills/` — repository skills (`bun run rules` generates agent copies)
2. `plugins/terreno-planning/skills/` — portable lifecycle stages
3. `<package>/.ai/skills/` — published package skills; these overlay the repo copies

Regenerate the installable tree:

```bash
bun run skills:sync
bun run check:lifecycle-skills
```

Do not hand-edit `skills/`.

## Write human docs with the skills

Skills read architecture docs before changing code. After a user-visible or architectural
change, update `docs/` in the same slice using `update-docs`. See
[lifecycle plugin](../reference/lifecycle-plugin.md) and the
[documentation contract](https://github.com/TerrenoLabs/terreno/blob/master/plugins/terreno-planning/references/documentation-contract.md).
