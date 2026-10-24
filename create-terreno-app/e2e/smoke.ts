/**
 * Real-process smoke for create-terreno-app. Run `bun e2e/smoke.ts` after `bun run compile`.
 *
 * Runs the compiled `create-terreno-app` binary with `--yes` in an empty temp directory, with
 * stdin at end-of-input, so it must finish on its flags alone. It checks that every package the
 * generated backend imports is declared in its `package.json`. Then it links the backend's
 * `node_modules` to the monorepo's, so every `@terreno/*` dependency resolves to its workspace
 * package and nothing is installed from the network, and runs the generated backend's own
 * `build` script (`bun build src/index.ts`). The bundle must hold modules from each workspace
 * package the backend depends on. Exits non-zero on the first failed check.
 */
import {existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync} from "node:fs";
import {builtinModules} from "node:module";
import {tmpdir} from "node:os";
import {dirname, join, resolve, sep} from "node:path";
import {fileURLToPath} from "node:url";
import {runBin} from "@terreno/test";
import {Glob} from "bun";

const APP_NAME = "smoke-app";
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Real paths, so they compare equal to what the CLI's cwd and `realpathSync` report on macOS.
const REPO_ROOT = realpathSync(resolve(PACKAGE_DIR, ".."));
/** Bundling the backend with mongoose, Better Auth, and Sentry takes about 3 s idle. */
const BUILD_TIMEOUT_MS = 30000;

/** Generated files the backend build and the next steps depend on. */
const EXPECTED_FILES = [
  "backend/package.json",
  "backend/src/index.ts",
  "backend/src/server.ts",
  "frontend/package.json",
  "frontend/app/_layout.tsx",
  "README.md",
];

interface PackageJson {
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  name?: string;
  scripts?: Record<string, string>;
  version?: string;
}

const readPackageJson = (path: string): PackageJson =>
  JSON.parse(readFileSync(path, "utf8")) as PackageJson;

/** The compiled CLI, found through the package's `bin` the way `bunx` finds it. */
const resolveBin = (): string => {
  const bin = readPackageJson(join(PACKAGE_DIR, "package.json")).bin?.["create-terreno-app"];
  if (!bin) {
    throw new Error("package.json has no create-terreno-app bin");
  }
  const binPath = join(PACKAGE_DIR, bin);
  if (!existsSync(binPath)) {
    throw new Error(`${bin} is missing; run \`bun run compile\` first`);
  }
  return binPath;
};

/** The package a bare import specifier names: `@scope/name` or `name`, without a subpath. */
const packageName = (specifier: string): string =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

/**
 * Packages the backend's sources import at runtime (type-only imports are dropped) that its
 * `dependencies` do not declare. The linked monorepo `node_modules` would resolve them anyway,
 * so the build alone cannot catch them; a scaffolded app's `bun install` would not get them.
 */
const undeclaredImports = ({
  backendDir,
  dependencies,
}: {
  backendDir: string;
  dependencies: Record<string, string>;
}): string[] => {
  const transpiler = new Bun.Transpiler({loader: "ts"});
  const imported = new Set(
    Array.from(new Glob("src/**/*.ts").scanSync(backendDir)).flatMap((file) =>
      transpiler
        .scanImports(readFileSync(join(backendDir, file), "utf8"))
        .map(({path}) => path)
        .filter((path) => !path.startsWith(".") && !path.startsWith("node:"))
        .map(packageName)
    )
  );
  return [...imported].filter((name) => !builtinModules.includes(name) && !dependencies[name]);
};

/**
 * Source paths bun writes as `// <path>` comments above each bundled module, made absolute.
 * Other `// ` comments resolve to paths that match no package, so they need no filtering.
 */
const bundledModulePaths = ({backendDir, bundle}: {backendDir: string; bundle: string}): string[] =>
  bundle
    .split("\n")
    .filter((line) => line.startsWith("// "))
    .map((line) => resolve(backendDir, line.slice(3)));

/** Generates an app with the compiled CLI and builds its backend against the workspace. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  const parentDir = realpathSync(mkdtempSync(join(tmpdir(), "create-terreno-app-smoke-")));

  try {
    const generated = await runBin({args: [APP_NAME, "--yes"], bin: resolveBin(), cwd: parentDir});
    const appDir = join(parentDir, APP_NAME);
    if (generated.exitCode !== 0) {
      throw new Error(
        `create-terreno-app exited ${generated.exitCode}:\n${generated.stdout}${generated.stderr}`
      );
    }
    if (!generated.stdout.includes(`Created ${appDir}`)) {
      throw new Error(`create-terreno-app did not report ${appDir}:\n${generated.stdout}`);
    }
    const missing = EXPECTED_FILES.filter((file) => !existsSync(join(appDir, file)));
    if (missing.length > 0) {
      throw new Error(`Generated app is missing: ${missing.join(", ")}`);
    }
    console.info("✅ The compiled CLI generates an app with `--yes` and no prompts");

    const backendDir = join(appDir, "backend");
    const backendPackage = readPackageJson(join(backendDir, "package.json"));
    if (backendPackage.name !== `@${APP_NAME}/backend` || !backendPackage.scripts?.build) {
      throw new Error(`Unexpected backend package.json: ${JSON.stringify(backendPackage)}`);
    }
    const dependencies = backendPackage.dependencies ?? {};
    const undeclared = undeclaredImports({backendDir, dependencies});
    if (undeclared.length > 0) {
      throw new Error(`Backend imports packages its package.json does not declare: ${undeclared}`);
    }
    console.info("✅ Every package the generated backend imports is in its dependencies");

    symlinkSync(join(REPO_ROOT, "node_modules"), join(backendDir, "node_modules"), "dir");
    const workspaceDeps = Object.keys(dependencies)
      .filter((name) => name.startsWith("@terreno/"))
      .map((name) => {
        const dir = realpathSync(join(backendDir, "node_modules", name));
        const {version} = readPackageJson(join(dir, "package.json"));
        return {dir, name, range: dependencies[name], version};
      });
    // A hoisted registry copy lives under node_modules; a workspace package does not.
    const notWorkspace = workspaceDeps.filter(
      ({dir, range, version}) =>
        !dir.startsWith(`${REPO_ROOT}${sep}`) ||
        dir.includes(`${sep}node_modules${sep}`) ||
        !version ||
        !Bun.semver.satisfies(version, range)
    );
    if (workspaceDeps.length === 0 || notWorkspace.length > 0) {
      throw new Error(
        `Backend @terreno deps must resolve to workspace packages in their declared range: ${JSON.stringify(workspaceDeps)}`
      );
    }
    console.info(
      `✅ The backend's ${workspaceDeps.map(({name}) => name).join(", ")} resolve to workspace packages in their declared range`
    );

    const built = await runBin({
      args: ["run", "build"],
      bin: process.execPath,
      cwd: backendDir,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const bundlePath = join(backendDir, "dist", "index.js");
    if (built.exitCode !== 0 || !existsSync(bundlePath)) {
      throw new Error(`Backend build exited ${built.exitCode}:\n${built.stdout}${built.stderr}`);
    }
    const modulePaths = bundledModulePaths({
      backendDir,
      bundle: readFileSync(bundlePath, "utf8"),
    });
    const notBundled = workspaceDeps.filter(
      ({dir}) => !modulePaths.some((path) => path.startsWith(join(dir, "dist") + sep))
    );
    if (notBundled.length > 0) {
      throw new Error(
        `Bundle holds no dist modules from: ${notBundled.map(({name}) => name).join(", ")}`
      );
    }
    console.info(
      `✅ The generated backend's \`bun run build\` bundles ${modulePaths.length} modules, including each workspace package's dist`
    );
  } finally {
    rmSync(parentDir, {force: true, recursive: true});
  }

  console.info(
    `create-terreno-app smoke passed in ${Math.round(performance.now() - startedAt)} ms`
  );
};

run().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
);
