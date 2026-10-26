---
category: Fixed
---

Pin Bun 1.4.4 in CI, package engines, and container images. 1.4.4 patches the Brotli decoder (CVE-2026-111497). `oven/bun:1` and `oven/bun:1-slim` can still resolve to an affected release, and `bun build --compile` embeds the builder's Bun binary. New apps from `create-terreno-app` get `oven/bun:1.4.4-slim`. Existing apps should set that tag in their Dockerfile and rebuild.
