import {describe, it} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";

import {resolveMetroFromSource} from "./metroFromSource";

const monorepoRoot = join(import.meta.dir, "..", "..");

describe("resolveMetroFromSource", () => {
  it("stays out of the way unless the CI export flag is set", () => {
    const previous = process.env.TERRENO_METRO_FROM_SOURCE;
    delete process.env.TERRENO_METRO_FROM_SOURCE;
    try {
      assert.equal(resolveMetroFromSource({moduleName: "@terreno/ui", monorepoRoot}), null);
    } finally {
      if (previous === undefined) {
        delete process.env.TERRENO_METRO_FROM_SOURCE;
      } else {
        process.env.TERRENO_METRO_FROM_SOURCE = previous;
      }
    }
  });

  it("maps package exports from dist onto the TypeScript source", () => {
    const previous = process.env.TERRENO_METRO_FROM_SOURCE;
    process.env.TERRENO_METRO_FROM_SOURCE = "1";
    try {
      assert.equal(
        resolveMetroFromSource({moduleName: "@terreno/ui", monorepoRoot}),
        join(monorepoRoot, "ui/src/index.tsx")
      );
      assert.equal(
        resolveMetroFromSource({moduleName: "@terreno/syncdb/react", monorepoRoot}),
        join(monorepoRoot, "syncdb/src/react/index.ts")
      );
      assert.equal(
        resolveMetroFromSource({moduleName: "@terreno/syncdb/api", monorepoRoot}),
        join(monorepoRoot, "syncdb/src/api/client.ts")
      );
      assert.equal(resolveMetroFromSource({moduleName: "react", monorepoRoot}), null);
    } finally {
      if (previous === undefined) {
        delete process.env.TERRENO_METRO_FROM_SOURCE;
      } else {
        process.env.TERRENO_METRO_FROM_SOURCE = previous;
      }
    }
  });
});
