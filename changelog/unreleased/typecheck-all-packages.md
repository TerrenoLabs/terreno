---
category: Added
---

Every workspace package has a `typecheck` script that runs `tsc` over source and test files through a new `tsconfig.typecheck.json`. Root `bun run lint` ends with `bun run typecheck`, and CircleCI runs it in a new `typecheck` job. Test files that had type errors were fixed.
