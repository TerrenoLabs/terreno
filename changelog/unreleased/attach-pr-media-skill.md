---
category: Added
---

`attach-pr-media` agent skill. It uploads local screenshots and recordings to one shared secret gist with only the `gh` token and posts Markdown that embeds them in the pull request, for sandboxes where `/opt/cursor/artifacts/` is unavailable. `verify-ui-changes` now points to it. Install with `npx skills add TerrenoLabs/terreno --skill attach-pr-media` or from the `terreno` Claude plugin.
