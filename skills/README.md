# Installable Terreno skills

Install from GitHub with the skills CLI:

```bash
npx skills add TerrenoLabs/terreno
npx skills add TerrenoLabs/terreno --skill terreno-1-grow
```

This directory is generated. Canonical sources:

| Source | Owns |
| --- | --- |
| `plugins/terreno-planning/skills/` | Lifecycle, Terreno app, docs, upgrade, deploy, and UI-verification workflows |
| `plugins/terreno-planning/agents/` | Pre-commit and UI verification agents |
| `.rulesync/skills/` | Terreno-repository-only and optional non-conflicting Expo skills |
| `<package>/.ai/skills/` | Package/MCP-specific copies; not installable overlays |

Regenerate with `bun run skills:sync`. Human-facing docs stay the architecture source;
follow `update-docs` and the lifecycle documentation contract.
