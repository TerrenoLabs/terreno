---
category: Fixed
---

`@terreno/api`: `modelRouter("/path", Model, options)` no longer builds a router at registration. `TerrenoApp` mounts the router from `_buildWithContext`, which has OpenAPI wired in, so the eager one was built for nothing and logged "No options.openApi provided" for every model at import. `registration.router` now builds on first read, for code that mounts a registration by hand.
