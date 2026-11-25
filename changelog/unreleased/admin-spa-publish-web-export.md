---
category: Fixed
---

`@terreno/admin-spa` publishes with its web export again. 58.1.1 shipped without `dist/`, so `AdminSpaServeApp` answered `/console` with 503. Both release paths (CircleCI `publish-release` and the GitHub `publish-on-tag` fallback) now run `build:web` before `npm publish`, and refuse to publish when `dist/server/_expo/routes.json` or `dist/client/_expo` is missing.
