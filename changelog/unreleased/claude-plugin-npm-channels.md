---
category: Added
---

- Claude Code plugins now publish to npm with every release, as `@terreno/claude-plugin` and `@terreno/claude-plugin-scan`. A new `terreno-releases` marketplace installs them at the latest stable release. To pin one release, add `TerrenoLabs/terreno#<version>` instead. See [Install agent skills](docs/how-to/install-agent-skills.md#pick-a-channel).
- The generated Claude plugin manifest no longer pins `version`. Before this change, plugins installed from the `TerrenoLabs/terreno` marketplace stayed on the `2.12.0` copy, because their version never changed. They now update on every commit. Run `/plugin update terreno@terreno-plugins` once to leave `2.12.0`.
