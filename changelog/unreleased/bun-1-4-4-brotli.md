---
category: Changed
---

`@terreno/cli` and `@terreno/mcp` require Bun `>=1.4.4`. 1.4.4 patches the Brotli decoder (CVE-2026-111497). CI, `example-backend`, and `mcp-server` images pin that release. `oven/bun:1` and `oven/bun:1-slim` can still resolve to an affected release, and `bun build --compile` embeds the builder's Bun binary. New apps from `create-terreno-app` get `oven/bun:1.4.4-slim`. Existing apps should set that tag in their Dockerfile and rebuild. See [Upgrade Terreno](docs/how-to/upgrade-terreno.md).

EAS build profiles stay on Bun 1.3.10. That pin is part of the Expo fingerprint, so changing it forces a native rebuild. Those profiles remain on an affected Bun release until that rebuild is scheduled.
