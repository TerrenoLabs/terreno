# Terreno Loop Claude Code plugin

Generated. Do not hand-edit. Run `bun run skills:sync`.

Claude Code resolves a plugin skill's command from the frontmatter `name`, so the
shortened scan-stage names live here instead of in the shared stage files. This plugin is
named `terreno-loop`, so Aim is `/terreno-loop:1-aim`.

| Source | Owns |
| --- | --- |
| `plugins/terreno-loop/skills/` | Aim, Sweep, Sift, Plot, Track, and the campaign loop |
| `plugins/terreno-loop/references/` | Scan contract, map-reduce, goal tracking, schemas |

Requires the `terreno` lifecycle plugin: Plot hands each slice to Grow, Pick, Roast,
Brew, and Taste. Cursor and `npx skills` keep the canonical `terreno-loop-*` names.
