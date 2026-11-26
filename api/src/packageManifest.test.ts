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

interface WorkspacePackage {
  dir: string;
  name: string;
  workspaceDeps: string[];
}

const readWorkspacePackages = (): WorkspacePackage[] => {
  const dirs = (readManifest(repoRoot).workspaces ?? []).filter((dir) =>
    existsSync(path.join(repoRoot, dir, "package.json"))
  );
  const manifests = dirs.map((dir) => ({
    dir,
    manifest: readManifest(path.join(repoRoot, dir)) as Manifest & {name?: string},
  }));
  const names = new Set(manifests.map(({manifest}) => manifest.name));
  return manifests.map(({dir, manifest}) => ({
    dir,
    name: manifest.name ?? dir,
    workspaceDeps: Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    }).filter((dep) => names.has(dep)),
  }));
};

// Every workspace package a package depends on, directly or through other workspace packages.
const workspaceClosure = (packages: WorkspacePackage[], start: string): Set<string> => {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const seen = new Set<string>();
  const pending = [...(byName.get(start)?.workspaceDeps ?? [])];
  while (pending.length > 0) {
    const next = pending.pop() as string;
    if (seen.has(next)) {
      continue;
    }
    seen.add(next);
    pending.push(...(byName.get(next)?.workspaceDeps ?? []));
  }
  return seen;
};

describe("workspace packages that import the test helpers", () => {
  const packages = readWorkspacePackages();
  // `@terreno/test` depends on these, so they cannot declare it back without a dependency
  // cycle. They resolve it through the workspace link instead.
  const testDependencies = workspaceClosure(packages, "@terreno/test");

  it("finds importers to check", () => {
    const importers = packages.filter(({dir}) => importsTestHelpers(path.join(repoRoot, dir)));
    expect(importers.map(({dir}) => dir)).toContain("api");
  });

  for (const {dir, name} of packages) {
    it(`${dir} declares @terreno/test when it imports it`, () => {
      if (
        dir === "test" ||
        testDependencies.has(name) ||
        !importsTestHelpers(path.join(repoRoot, dir))
      ) {
        return;
      }
      const manifest = readManifest(path.join(repoRoot, dir));
      expect(manifest.devDependencies?.["@terreno/test"]).toBeDefined();
    });
  }

  // A cycle breaks `bun run --filter '*' compile`: packages start before their dependencies build.
  it("has no workspace dependency cycles", () => {
    const cyclic = packages
      .filter(({name}) => workspaceClosure(packages, name).has(name))
      .map(({name}) => name);
    expect(cyclic).toEqual([]);
  });
});
