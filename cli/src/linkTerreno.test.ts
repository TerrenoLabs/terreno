import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {generateAllFiles} from "create-terreno-app";

import {runBootstrapCommand} from "./commands/bootstrap";
import type {CliIo} from "./io";
import {
  type LinkTerrenoOptions,
  type LinkTerrenoPlan,
  linkTerreno,
  prepareLinkTerreno,
} from "./linkTerreno";
import {parseArgs} from "./parseArgs";

interface FixtureManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  scripts?: Record<string, string>;
}

interface ExportMap {
  [key: string]: ExportMap | string;
}

interface PublishedPackageManifest {
  bin?: Record<string, string> | string;
  exports?: ExportMap | string;
  files?: string[];
  main?: string;
  types?: string;
}

const exportTargets = (value: ExportMap | string | undefined): string[] => {
  if (typeof value === "string") {
    return [value];
  }
  if (!value) {
    return [];
  }
  return Object.values(value).flatMap((target): string[] => exportTargets(target));
};

const isCoveredByFiles = (target: string, files: string[]): boolean => {
  const representative = target.replace(/^\.\//, "").replaceAll("*", "target");
  return files.some((pattern): boolean => {
    return !pattern.startsWith("!") && new Bun.Glob(pattern).match(representative);
  });
};

test("published package files cover all entry points", async (): Promise<void> => {
  const repositoryRoot = join(import.meta.dir, "..", "..");
  const packageDirectories = [
    "api",
    "admin-backend",
    "api-health",
    "blocks",
    "jobs",
    "admin-frontend",
    "test",
  ];
  for (const directory of packageDirectories) {
    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, directory, "package.json"), "utf8")
    ) as PublishedPackageManifest;
    const files = manifest.files ?? [];
    expect(files, `${directory} must publish dist`).toContain("dist/**/*");
    const binTargets =
      typeof manifest.bin === "string" ? [manifest.bin] : Object.values(manifest.bin ?? {});
    const targets = [
      ...(manifest.main ? [manifest.main] : []),
      ...(manifest.types ? [manifest.types] : []),
      ...binTargets,
      ...exportTargets(manifest.exports),
    ];
    for (const target of targets) {
      expect(isCoveredByFiles(target, files), `${directory} files do not cover ${target}`).toBe(
        true
      );
    }
  }
});

describe("checkout packages for bootstrap", (): void => {
  let root: string;
  let checkout: string;
  let appRoot: string;

  beforeEach(async (): Promise<void> => {
    root = await mkdtemp(join(tmpdir(), "terreno-link-"));
    checkout = join(root, "checkout with spaces");
    appRoot = join(root, "app");
    await mkdir(checkout);
  });

  afterEach(async (): Promise<void> => {
    await rm(root, {force: true, recursive: true});
  });

  const writeManifest = async (directory: string, manifest: FixtureManifest): Promise<void> => {
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
  };

  const addPackage = async (
    directory: string,
    manifest: FixtureManifest,
    compiled = true
  ): Promise<void> => {
    const packageDir = join(checkout, directory);
    await writeManifest(packageDir, manifest);
    if (compiled) {
      await mkdir(join(packageDir, "dist"));
    }
  };

  const pack = mock(
    async ({
      destination,
      packageDir,
    }: Parameters<NonNullable<LinkTerrenoOptions["pack"]>>[0]): Promise<string> => {
      return join(destination, `${basename(packageDir)}-1.0.0.tgz`);
    }
  );

  const prepareFromWrittenManifests = async (checkoutPath = checkout): Promise<LinkTerrenoPlan> => {
    const files = await Promise.all(
      ["backend/package.json", "frontend/package.json"].map(
        async (path): Promise<{content: string; path: string}> => ({
          content: await readFile(join(appRoot, path), "utf8"),
          path,
        })
      )
    );
    return prepareLinkTerreno({checkout: checkoutPath, files});
  };

  beforeEach((): void => {
    pack.mockClear();
  });

  test("packs the runtime closure once and preserves other manifest keys", async (): Promise<void> => {
    await addPackage("api", {
      dependencies: {"@terreno/jobs": "workspace:*", express: "^5"},
      devDependencies: {"@terreno/dev-only": "workspace:*"},
      name: "@terreno/api",
    });
    await addPackage("jobs", {name: "@terreno/jobs", peerDependencies: {"@terreno/blocks": "*"}});
    await addPackage("blocks", {
      name: "@terreno/blocks",
      optionalDependencies: {"@terreno/ui": "*"},
    });
    await addPackage("ui", {dependencies: {"@terreno/api": "*"}, name: "@terreno/ui"});
    await addPackage("unused", {name: "@terreno/unused"}, false);
    await writeManifest(join(checkout, "not-terreno"), {name: "other"});
    await mkdir(join(checkout, "no-manifest"));
    const backend = {
      dependencies: {"@terreno/api": "^58", express: "^5"},
      devDependencies: {typescript: "^6"},
      name: "backend",
      overrides: {"@terreno/api": "old", bson: "^6"},
      private: true,
      scripts: {start: "bun src/index.ts"},
    };
    const frontend = {dependencies: {"@terreno/ui": "^58", react: "^19"}, name: "frontend"};
    await writeManifest(join(appRoot, "backend"), backend);
    await writeManifest(join(appRoot, "frontend"), frontend);

    const plan = await prepareFromWrittenManifests();
    const linked = await linkTerreno({appRoot, pack, plan});
    expect(linked).toEqual(["@terreno/api", "@terreno/blocks", "@terreno/jobs", "@terreno/ui"]);
    expect(pack.mock.calls).toEqual(
      ["api", "blocks", "jobs", "ui"].map((name): [{destination: string; packageDir: string}] => [
        {
          destination: join(appRoot, "vendor", "terreno"),
          packageDir: join(checkout, name),
        },
      ])
    );
    const overrides = Object.fromEntries(
      linked.map((name): [string, string] => [
        name,
        `file:../vendor/terreno/${name.slice("@terreno/".length)}-1.0.0.tgz`,
      ])
    );
    const readApp = async (directory: string): Promise<FixtureManifest> => {
      const content = await readFile(join(appRoot, directory, "package.json"), "utf8");
      expect(content).not.toContain(checkout);
      return JSON.parse(content) as FixtureManifest;
    };
    expect(await readApp("backend")).toEqual({
      ...backend,
      dependencies: {...backend.dependencies, "@terreno/api": overrides["@terreno/api"]},
      overrides: {...backend.overrides, ...overrides},
    });
    expect(await readApp("frontend")).toEqual({
      ...frontend,
      dependencies: {...frontend.dependencies, "@terreno/ui": overrides["@terreno/ui"]},
      overrides,
    });
  });

  test("rejects missing transitive dist before any package is packed", async (): Promise<void> => {
    await addPackage("api", {dependencies: {"@terreno/jobs": "*"}, name: "@terreno/api"});
    await addPackage("jobs", {name: "@terreno/jobs"}, false);
    await writeManifest(join(appRoot, "backend"), {dependencies: {"@terreno/api": "^58"}});
    await writeManifest(join(appRoot, "frontend"), {});

    await expect(prepareFromWrittenManifests()).rejects.toThrow(
      "@terreno/jobs has no dist directory. Run bun run compile in the Terreno checkout."
    );
    expect(pack).not.toHaveBeenCalled();
    expect(await readFile(join(appRoot, "backend", "package.json"), "utf8")).toBe(
      JSON.stringify({dependencies: {"@terreno/api": "^58"}})
    );
  });

  test("rejects a checkout with no Terreno packages before packing", async (): Promise<void> => {
    await writeManifest(join(checkout, "other"), {name: "other"});
    await expect(prepareLinkTerreno({checkout, files: []})).rejects.toThrow(
      "no top-level @terreno/* packages"
    );
    expect(pack).not.toHaveBeenCalled();
  });

  test("rejects a closure package missing from the checkout before packing", async (): Promise<void> => {
    await addPackage("api", {name: "@terreno/api", peerDependencies: {"@terreno/missing": "*"}});
    await writeManifest(join(appRoot, "backend"), {dependencies: {"@terreno/api": "^58"}});
    await writeManifest(join(appRoot, "frontend"), {});
    await expect(prepareFromWrittenManifests()).rejects.toThrow("missing package @terreno/missing");
    expect(pack).not.toHaveBeenCalled();
  });

  test("real packing includes files ignored by git", async (): Promise<void> => {
    const packageDir = join(root, "pack-source");
    const packedRoot = join(root, "packed");
    const destination = join(packedRoot, "vendor", "terreno");
    await mkdir(join(packageDir, "dist"), {recursive: true});
    await writeFile(join(packageDir, ".gitignore"), "dist\n");
    await writeFile(join(packageDir, "dist", "index.js"), "export const value = true;\n");
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({files: ["dist/**/*"], name: "pack-files-test", version: "1.0.0"})
    );

    await linkTerreno({
      appRoot: packedRoot,
      plan: {
        manifests: [],
        packagesToPack: [{directory: packageDir, name: "pack-files-test"}],
      },
    });
    const tarballPath = join(destination, "pack-files-test-1.0.0.tgz");
    expect(existsSync(tarballPath)).toBe(true);
    const process = Bun.spawn(["tar", "-tzf", tarballPath], {
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.split("\n")).toContain("package/dist/index.js");
  });

  const createIo = (stdoutLines: string[], stderrLines: string[] = []): CliIo => ({
    cwd: root,
    env: {},
    fetch: globalThis.fetch,
    stderr: (line): void => {
      stderrLines.push(line);
    },
    stdout: (line): void => {
      stdoutLines.push(line);
    },
  });

  test("bootstrap without the flag leaves generated manifests unchanged", async (): Promise<void> => {
    const lines: string[] = [];
    const parsed = parseArgs(["bootstrap", "app", "--name", "demo-app", "--dir", "app"]);
    expect(await runBootstrapCommand(parsed, createIo(lines), true, pack)).toBe(0);
    expect(pack).not.toHaveBeenCalled();
    for (const file of generateAllFiles({appDisplayName: "demo-app", appName: "demo-app"})) {
      if (file.path.endsWith("/package.json")) {
        expect(await readFile(join(appRoot, file.path), "utf8")).toBe(file.content);
      }
    }
    expect(JSON.parse(lines[0]).linkedPackages).toEqual([]);
  });

  test("bootstrap rejects terreno-path without a usable value before writing", async (): Promise<void> => {
    const variants = [["--terreno-path"], ["--terreno-path", "--other"], ["--terreno-path", ""]];
    for (const [index, variant] of variants.entries()) {
      const directory = `invalid-value-${String(index)}`;
      const stderrLines: string[] = [];
      const parsed = parseArgs([
        "bootstrap",
        "app",
        "--name",
        "demo-app",
        "--dir",
        directory,
        ...variant,
      ]);
      expect(await runBootstrapCommand(parsed, createIo([], stderrLines), false, pack)).toBe(1);
      expect(stderrLines).toEqual(["--terreno-path requires a non-empty checkout path."]);
      expect(existsSync(join(root, directory))).toBe(false);
    }
  });

  test("bootstrap rejects a nonexistent checkout before writing", async (): Promise<void> => {
    const stderrLines: string[] = [];
    const parsed = parseArgs([
      "bootstrap",
      "app",
      "--name",
      "demo-app",
      "--dir",
      "nonexistent-app",
      "--terreno-path",
      "missing-checkout",
    ]);
    expect(await runBootstrapCommand(parsed, createIo([], stderrLines), false, pack)).toBe(1);
    expect(stderrLines).toEqual([
      `Terreno checkout path does not exist: ${join(root, "missing-checkout")}`,
    ]);
    expect(existsSync(join(root, "nonexistent-app"))).toBe(false);
  });

  test("bootstrap rejects a checkout file before writing", async (): Promise<void> => {
    const checkoutFile = join(root, "checkout-file");
    await writeFile(checkoutFile, "not a directory");
    const stderrLines: string[] = [];
    const parsed = parseArgs([
      "bootstrap",
      "app",
      "--name",
      "demo-app",
      "--dir",
      "file-app",
      "--terreno-path",
      checkoutFile,
    ]);
    expect(await runBootstrapCommand(parsed, createIo([], stderrLines), false, pack)).toBe(1);
    expect(stderrLines).toEqual([`Terreno checkout path is not a directory: ${checkoutFile}`]);
    expect(existsSync(join(root, "file-app"))).toBe(false);
  });

  test("bootstrap rejects a checkout without Terreno packages before writing", async (): Promise<void> => {
    const stderrLines: string[] = [];
    const parsed = parseArgs([
      "bootstrap",
      "app",
      "--name",
      "demo-app",
      "--dir",
      "empty-app",
      "--terreno-path",
      checkout,
    ]);
    expect(await runBootstrapCommand(parsed, createIo([], stderrLines), false, pack)).toBe(1);
    expect(stderrLines).toEqual([
      "The Terreno checkout contains no top-level @terreno/* packages.",
    ]);
    expect(existsSync(join(root, "empty-app"))).toBe(false);
  });

  test("bootstrap rejects an uncompiled checkout before writing", async (): Promise<void> => {
    const names = ["admin-backend", "admin-frontend", "api", "api-health", "syncdb", "ui"];
    for (const name of names) {
      await addPackage(name, {name: `@terreno/${name}`}, name !== "api");
    }
    const stderrLines: string[] = [];
    const parsed = parseArgs([
      "bootstrap",
      "app",
      "--name",
      "demo-app",
      "--dir",
      "uncompiled-app",
      "--terreno-path",
      checkout,
    ]);
    expect(await runBootstrapCommand(parsed, createIo([], stderrLines), false, pack)).toBe(1);
    expect(stderrLines).toEqual([
      "@terreno/api has no dist directory. Run bun run compile in the Terreno checkout.",
    ]);
    expect(existsSync(join(root, "uncompiled-app"))).toBe(false);
  });

  test("bootstrap reports linked packages in JSON and text without recording the checkout", async (): Promise<void> => {
    const names = ["admin-backend", "admin-frontend", "api", "api-health", "syncdb", "ui"];
    for (const name of names) {
      await addPackage(name, {name: `@terreno/${name}`});
    }
    for (const json of [true, false]) {
      const lines: string[] = [];
      const dir = json ? "json-app" : "text-app";
      const parsed = parseArgs([
        "bootstrap",
        "app",
        "--name",
        "demo-app",
        "--dir",
        dir,
        "--terreno-path",
        "checkout with spaces",
      ]);
      expect(await runBootstrapCommand(parsed, createIo(lines), json, pack)).toBe(0);
      if (json) {
        expect(JSON.parse(lines[0]).linkedPackages).toEqual(
          names.map((name): string => `@terreno/${name}`)
        );
      } else {
        expect(lines[1]).toBe(
          `Linked Terreno packages: ${names.map((name): string => `@terreno/${name}`).join(", ")}`
        );
      }
      for (const file of generateAllFiles({appDisplayName: "demo-app", appName: "demo-app"})) {
        expect(await readFile(join(root, dir, file.path), "utf8")).not.toContain(checkout);
      }
    }
  });
});
