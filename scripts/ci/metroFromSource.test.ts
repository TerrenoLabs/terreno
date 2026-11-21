import {describe, it} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";

import {applyCiMetroWorkerCap, resolveMetroFromSource} from "./metroFromSource";

const monorepoRoot = join(import.meta.dir, "..", "..");

const withEnv = ({env, run}: {env: Record<string, string | undefined>; run: () => void}): void => {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
};

describe("applyCiMetroWorkerCap", () => {
  it("leaves Metro's worker count alone outside CI", () => {
    const config: {maxWorkers?: number} = {};
    withEnv({
      env: {CI: undefined, TERRENO_METRO_MAX_WORKERS: undefined},
      run: () => applyCiMetroWorkerCap(config),
    });
    assert.isUndefined(config.maxWorkers);
  });

  it("caps workers at 4 in CI by default", () => {
    const config: {maxWorkers?: number} = {};
    withEnv({
      env: {CI: "true", TERRENO_METRO_MAX_WORKERS: undefined},
      run: () => applyCiMetroWorkerCap(config),
    });
    assert.equal(config.maxWorkers, 4);
  });

  it("honors TERRENO_METRO_MAX_WORKERS and falls back on invalid values", () => {
    const custom: {maxWorkers?: number} = {};
    withEnv({
      env: {CI: "true", TERRENO_METRO_MAX_WORKERS: "2"},
      run: () => applyCiMetroWorkerCap(custom),
    });
    assert.equal(custom.maxWorkers, 2);
    for (const invalid of ["0", "-3", "1.5", "many"]) {
      const config: {maxWorkers?: number} = {};
      withEnv({
        env: {CI: "true", TERRENO_METRO_MAX_WORKERS: invalid},
        run: () => applyCiMetroWorkerCap(config),
      });
      assert.equal(config.maxWorkers, 4, invalid);
    }
  });
});

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

  it("maps deep dist subpaths through the most specific export pattern", () => {
    const previous = process.env.TERRENO_METRO_FROM_SOURCE;
    process.env.TERRENO_METRO_FROM_SOURCE = "1";
    try {
      assert.equal(
        resolveMetroFromSource({moduleName: "@terreno/ui/dist/DateUtilities", monorepoRoot}),
        join(monorepoRoot, "ui/src/DateUtilities.tsx")
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TERRENO_METRO_FROM_SOURCE;
      } else {
        process.env.TERRENO_METRO_FROM_SOURCE = previous;
      }
    }
  });
});
