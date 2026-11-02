---
category: Breaking
---

- The `terreno-scan` plugin is now `terreno-loop`, and its skills are renamed from `terreno-scan-*` to `terreno-loop-*`. The resident loop `terreno-scan-loop` is now `terreno-loop-run`: `/terreno-loop:run` in Claude Code, `/terreno-loop-run` in Cursor, `$terreno-loop-run` in Codex. Claude Code moves existing installs over through the marketplace `renames` entry. In Cursor and Codex, uninstall `terreno-scan` and install `terreno-loop`. Campaign state stays at `.terreno/scan/<goal>.json`, so campaigns already in progress resume.
