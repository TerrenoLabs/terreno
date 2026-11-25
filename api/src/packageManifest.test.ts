/**
 * Manifest checks for `@terreno/api`: `@terreno/test` is an optional peer, the tarball ships
 * no test files, and every workspace package that imports the test helpers declares them.
 */
import {describe, expect, it} from "bun:test";
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, {optional?: boolean}>;
  files?: string[];
  workspaces?: string[];
}

const apiDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiDir, "..");
const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

const IMPORT_PATTERN = /["'`]@terreno\/(api\/testing|test)(\/[^"'`]*)?["'`]/;
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".expo", "build", ".git", "versioned_docs"]);

const importsTestHelpers = (dir: string): boolean => {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (importsTestHelpers(full)) {
        return true;
      }
      continue;
    }
    if (SOURCE_EXTENSION.test(entry) && IMPORT_PATTERN.test(readFileSync(full, "utf8"))) {
      return true;
    }
  }
  return false;
};

const packedFiles = (): string[] => {
  const result = Bun.spawnSync(["bun", "pm", "pack", "--dry-run"], {cwd: apiDir});
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  return output
    .split("\n")
    .map((line) => line.match(/^packed\s+\S+\s+(.+)$/)?.[1]?.trim())
    .filter((file): file is string => Boolean(file));
};

describe("@terreno/api package manifest", () => {
  const manifest = readManifest(apiDir);

  it("does not list @terreno/test in dependencies", () => {
    expect(manifest.dependencies?.["@terreno/test"]).toBeUndefined();
  });

  it("lists @terreno/test as an optional peer", () => {
    expect(manifest.peerDependencies?.["@terreno/test"]).toBeDefined();
    expect(manifest.peerDependenciesMeta?.["@terreno/test"]?.optional).toBe(true);
  });

  it("keeps @terreno/test in devDependencies", () => {
    expect(manifest.devDependencies?.["@terreno/test"]).toBeDefined();
  });

  it("still ships src, types, and dist in the files list", () => {
    expect(manifest.files).toContain("src/**/*");
    expect(manifest.files).toContain("types/**/*");
    expect(manifest.files).toContain("dist/**/*");
  });

  it("excludes tests, snapshots, and fixtures via the files list", () => {
    expect(manifest.files).toContain("!src/**/*.test.ts");
    expect(manifest.files).toContain("!src/**/__snapshots__/**");
    expect(manifest.files).toContain("!src/tests/fixtures/**");
  });
});

describe("@terreno/api packed file list", () => {
  const files = packedFiles();

  it("lists files at all", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no test files or snapshots", () => {
    expect(files.filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
    expect(files.filter((file) => /__snapshots__\//.test(file))).toEqual([]);
  });

  it("contains no test fixtures", () => {
    expect(files.filter((file) => file.startsWith("src/tests/fixtures/"))).toEqual([]);
  });

  it("still ships the migrate CLI source and the express user typing", () => {
    expect(files).toContain("src/migrations/cli.ts");
    expect(files).toContain("types/expressUser.d.ts");
  });

  it("ships the built entry points when dist is built", () => {
    // dist only exists after `bun run compile`; the files list check above covers the glob.
    if (!existsSync(path.join(apiDir, "dist", "tests.js"))) {
      return;
    }
    expect(files).toContain("dist/tests.js");
    expect(files).toContain("dist/index.js");
  });
});

describe("workspace packages that import the test helpers", () => {
  const workspaces = (readManifest(repoRoot).workspaces ?? []).filter((dir) =>
    existsSync(path.join(repoRoot, dir, "package.json"))
  );

  it("finds importers to check", () => {
    const importers = workspaces.filter((dir) => importsTestHelpers(path.join(repoRoot, dir)));
    expect(importers).toContain("api");
  });

  for (const dir of workspaces) {
    it(`${dir} declares @terreno/test when it imports it`, () => {
      if (dir === "test" || !importsTestHelpers(path.join(repoRoot, dir))) {
        return;
      }
      const manifest = readManifest(path.join(repoRoot, dir));
      expect(manifest.devDependencies?.["@terreno/test"]).toBeDefined();
    });
  }
});
