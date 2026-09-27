---
category: Changed
---

- Knip now runs in a dedicated CircleCI `knip` job on every pipeline instead of the `Knip / Zero findings` GitHub workflow and the `repo-policies` static-analysis step. `repo-policies` runs only dependency-cruiser via the new `bun run check:dependency-cruiser`, and `bun run prepush` always runs `bun run check:knip`. Require the `knip` check in branch protection in place of `Knip / Zero findings`.
