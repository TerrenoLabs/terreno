---
category: Fixed
---

- A server bundled with `bun build --compile` no longer crashes at startup with "tsyringe requires a reflect polyfill". `@terreno/api` now depends on `reflect-metadata` and loads it before the passkey plugin, whose `@peculiar/x509` dependency needs it.
