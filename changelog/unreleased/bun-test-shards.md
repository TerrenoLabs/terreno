---
category: Changed
---

Package tests run as concurrent `bun test --shard` processes through `scripts/test-shards.ts` (half the cores by default, `TERRENO_TEST_SHARDS` to override), and `test:coverage` merges the shards' LCOV. CircleCI now pins Bun 1.4.4, the same version as the local toolchain.
