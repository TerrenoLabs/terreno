#!/usr/bin/env bun
import {execFileSync, spawn} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative, resolve, sep} from "node:path";
import {Glob} from "bun";

import {
  type CoverageSummary,
  evaluateCoverage,
  type FileCoverage,
  isBunCoverageThresholdExit,
  parseLcov,
  summarizeLcov,
} from "./check-coverage";

const DEFAULT_THRESHOLD = 90;
const normalizePath = (path: string): string => path.split(sep).join("/");
const SOURCE_FILE_PATTERN = /\.(?:ts|tsx)$/;
const EXCLUDED_SOURCE_PATTERN =
  /(?:^|\/)(?:dist|coverage|e2e|node_modules|isolated|tests|testing|fixtures)(?:\/|$)|(?:^|\/)types\/.+\.ts$|(?:^|\/)types\.ts$|(?:^|\/)jobsWorker\.ts$|(?:^|\/)story-config\/.+\.config\.tsx$|\.(?:test|spec|stories)\.(?:ts|tsx)$|openApiSdk\.ts$/;
/**
 * Expo Router route files under `app/`: `index`, `_layout`, `+not-found`, dynamic
 * segments such as `[id]`, thin `create` wrappers, and named recovery routes
 * (`forgotPassword`, `resetPassword`, `verifyEmail`). Those recovery screens are
 * Playwright e2e; submit logic lives in `lib/authRecoveryActions.ts`. Ordinary
 * modules under `app/` stay gated.
 */
const EXPO_ROUTER_ENTRY_PATTERN =
  /(?:^|\/)app\/(?:.*\/)?(?:index|_layout|create|\+[^/]+|\[[^/]+\]|forgotPassword|resetPassword|verifyEmail)\.tsx$/;

export interface NewFileCoverageFailure {
  path: string;
  summary: CoverageSummary | null;
}

export interface ParsedArgs {
  base: string;
  lcovPath: string | null;
  packageName: string | null;
  skipPackages: string[];
  threshold: number;
}

interface PackageCoverage {
  packageName: string;
  files: string[];
}

/** Packages whose dedicated CI already ran `test:coverage` and wrote LCOV. */
export const PACKAGE_CI_LCOV_SKIP: {packageName: string; pipelineParameter: string}[] = [
  {packageName: "admin-backend", pipelineParameter: "run-admin-backend"},
  {packageName: "admin-frontend", pipelineParameter: "run-admin-frontend"},
  {packageName: "admin-spa", pipelineParameter: "run-admin-spa"},
  {packageName: "ai", pipelineParameter: "run-ai"},
  {packageName: "api", pipelineParameter: "run-api"},
  {packageName: "api-health", pipelineParameter: "run-api-health"},
  {packageName: "blocks", pipelineParameter: "run-blocks"},
  {packageName: "comms", pipelineParameter: "run-comms"},
  {packageName: "create-terreno-app", pipelineParameter: "run-create-terreno-app"},
  {packageName: "feature-flags", pipelineParameter: "run-feature-flags"},
  {packageName: "jobs", pipelineParameter: "run-jobs"},
  {packageName: "mcp-server", pipelineParameter: "run-mcp-server"},
  {packageName: "rtk", pipelineParameter: "run-rtk"},
  {packageName: "syncdb", pipelineParameter: "run-syncdb"},
  {packageName: "test", pipelineParameter: "run-test-package"},
  {packageName: "ui", pipelineParameter: "run-ui"},
];

const splitCsv = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const parseNewFileCoverageArgs = (argv: readonly string[]): ParsedArgs => {
  let base = "";
  let lcovPath: string | null = null;
  let packageName: string | null = null;
  let skipPackages: string[] = [];
  let threshold = DEFAULT_THRESHOLD;
  for (const arg of argv) {
    const baseMatch = arg.match(/^--base=(.+)$/);
    if (baseMatch) {
      base = baseMatch[1];
    }
    const thresholdMatch = arg.match(/^--threshold=(\d+(?:\.\d+)?)$/);
    if (thresholdMatch) {
      threshold = Number(thresholdMatch[1]);
    }
    const lcovMatch = arg.match(/^--lcov=(.+)$/);
    if (lcovMatch) {
      lcovPath = lcovMatch[1];
    }
    const packageMatch = arg.match(/^--package=(.+)$/);
    if (packageMatch) {
      packageName = packageMatch[1];
    }
    const skipMatch = arg.match(/^--skip-packages=(.*)$/);
    if (skipMatch) {
      skipPackages = splitCsv(skipMatch[1]);
    }
  }
  return {base, lcovPath, packageName, skipPackages, threshold};
};

export const colocatedTestCandidates = (repoRelativeSource: string): string[] => {
  const withoutExt = repoRelativeSource.replace(/\.tsx?$/, "");
  return [
    `${withoutExt}.test.ts`,
    `${withoutExt}.test.tsx`,
    `${withoutExt}.spec.ts`,
    `${withoutExt}.spec.tsx`,
  ];
};

export const findColocatedTests = ({
  files,
  packageRoot,
  repoRoot,
}: {
  files: readonly string[];
  packageRoot: string;
  repoRoot: string;
}): string[] | null => {
  const tests = new Set<string>();
  for (const file of files) {
    const matches = colocatedTestCandidates(file).filter((candidate) =>
      existsSync(join(repoRoot, candidate))
    );
    if (matches.length === 0) {
      return null;
    }
    for (const match of matches) {
      tests.add(normalizePath(relative(packageRoot, resolve(repoRoot, match))));
    }
  }
  return [...tests].sort();
};

const terrenoPackageDir = (packageName: string): string => {
  if (packageName === "@terreno/mcp") {
    return "mcp-server";
  }
  return packageName.replace("@terreno/", "");
};

export const packageNeedsCompiledDistDeps = (packageRoot: string): boolean => {
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const names = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ];
  for (const name of names) {
    if (!name.startsWith("@terreno/")) {
      continue;
    }
    const depJsonPath = join(packageRoot, "..", terrenoPackageDir(name), "package.json");
    if (!existsSync(depJsonPath)) {
      continue;
    }
    const depJson = JSON.parse(readFileSync(depJsonPath, "utf8")) as {
      exports?: {"."?: {default?: string}};
      main?: string;
    };
    const entry = depJson.exports?.["."]?.default ?? depJson.main ?? "";
    if (entry.includes("dist")) {
      return true;
    }
  }
  return false;
};

export const isCoverageSourceFile = (path: string): boolean => {
  return (
    SOURCE_FILE_PATTERN.test(path) &&
    !EXCLUDED_SOURCE_PATTERN.test(path) &&
    !EXPO_ROUTER_ENTRY_PATTERN.test(path)
  );
};

const findFileCoverage = (
  coverage: Map<string, FileCoverage>,
  packageRoot: string,
  repoRelativePath: string
): FileCoverage | null => {
  const packageRelativePath = normalizePath(relative(packageRoot, resolve(repoRelativePath)));
  for (const [coveredPath, fileCoverage] of coverage.entries()) {
    const normalizedCoveredPath = normalizePath(coveredPath);
    if (
      normalizedCoveredPath === packageRelativePath ||
      normalizedCoveredPath.endsWith(`/${packageRelativePath}`)
    ) {
      return fileCoverage;
    }
  }
  return null;
};

const globToRegExp = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "@@GLOBSTAR@@")
    .replace(/\*/g, "[^/]*")
    .replace(/@@GLOBSTAR@@/g, ".*");
  return new RegExp(`(?:^|/)${escaped}$`);
};

export const readCoveragePathIgnorePatterns = (packageRoot: string): string[] => {
  const bunfigPath = join(packageRoot, "bunfig.toml");
  if (!existsSync(bunfigPath)) {
    return [];
  }
  const match = readFileSync(bunfigPath, "utf8").match(
    /coveragePathIgnorePatterns\s*=\s*\[([^\]]*)\]/
  );
  if (!match?.[1]) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1] ?? "").filter(Boolean);
};

export const isCoveragePathIgnored = (packageRelativePath: string, patterns: string[]): boolean => {
  const normalized = normalizePath(packageRelativePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
};

export const evaluateNewFileCoverage = ({
  coverage,
  files,
  packageRoot,
  repoRoot,
  threshold,
}: {
  coverage: Map<string, FileCoverage>;
  files: readonly string[];
  packageRoot: string;
  repoRoot: string;
  threshold: number;
}): NewFileCoverageFailure[] => {
  const ignorePatterns = readCoveragePathIgnorePatterns(packageRoot);
  const failures: NewFileCoverageFailure[] = [];
  for (const file of files) {
    const absoluteFile = resolve(repoRoot, file);
    const packageRelativePath = normalizePath(relative(packageRoot, absoluteFile));
    if (isCoveragePathIgnored(packageRelativePath, ignorePatterns)) {
      continue;
    }
    const fileCoverage = findFileCoverage(coverage, packageRoot, absoluteFile);
    if (!fileCoverage) {
      failures.push({path: file, summary: null});
      continue;
    }
    const summary = summarizeLcov(new Map([[file, fileCoverage]]));
    if (evaluateCoverage(summary, threshold).length > 0) {
      failures.push({path: file, summary});
    }
  }
  return failures;
};

const getWorkspaceNames = (repoRoot: string): Set<string> => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    workspaces?: string[];
  };
  return new Set(packageJson.workspaces ?? []);
};

const getAddedSourceFiles = (repoRoot: string, base: string): string[] => {
  const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=A", `${base}...HEAD`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0 && isCoverageSourceFile(path));
};

export const groupFilesByWorkspace = ({
  files,
  workspaces,
}: {
  files: readonly string[];
  workspaces: ReadonlySet<string>;
}): PackageCoverage[] => {
  const grouped = new Map<string, string[]>();
  for (const file of files) {
    const packageName = file.split("/")[0];
    if (!workspaces.has(packageName)) {
      continue;
    }
    const packageFiles = grouped.get(packageName) ?? [];
    packageFiles.push(file);
    grouped.set(packageName, packageFiles);
  }
  return [...grouped.entries()]
    .map(([packageName, packageFiles]) => ({files: packageFiles.sort(), packageName}))
    .sort((left, right) => left.packageName.localeCompare(right.packageName));
};

export const expandCoverageFileArgs = (args: readonly string[], cwd: string): string[] => {
  const expanded: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-") || !arg.includes("*")) {
      expanded.push(arg);
      continue;
    }
    const pattern = arg.startsWith("./") ? arg.slice(2) : arg;
    const matches = [...new Glob(pattern).scanSync({cwd, onlyFiles: true})].sort();
    expanded.push(...matches.map((path) => `./${path}`));
  }
  return expanded;
};

const BUN_TEST_VALUE_FLAGS = new Set([
  "--bail",
  "--config",
  "--coverage-dir",
  "--cwd",
  "--max-concurrency",
  "--preload",
  "--reporter",
  "--rerun-each",
  "--seed",
  "--test-name-pattern",
  "--timeout",
  "-c",
  "-r",
  "-t",
]);

export const bunTestFileArgs = (testScript: string | undefined): string[] => {
  if (!testScript) {
    return [];
  }
  const firstCommand = testScript.split("&&")[0]?.trim() ?? "";
  const match = firstCommand.match(/^bun(?:x)?\s+test(?:\s+(.*))?$/);
  if (!match?.[1]) {
    return [];
  }
  const tokens = match[1].split(/\s+/).filter((token) => token.length > 0);
  const files: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("-")) {
      const flag = token.split("=")[0];
      if (!token.includes("=") && BUN_TEST_VALUE_FLAGS.has(flag)) {
        index += 1;
      }
      continue;
    }
    files.push(token);
  }
  return files;
};

export const coverageRunArgs = ({
  colocatedTests,
  hasSrcDir,
  packageName,
  testScript,
}: {
  colocatedTests?: string[] | null;
  hasSrcDir: boolean;
  packageName: string;
  testScript?: string;
}): string[] => {
  const args: string[] = [];
  if (packageName === "mcp-server") {
    args.push("--max-concurrency=1");
  }
  if (colocatedTests && colocatedTests.length > 0) {
    args.push(...colocatedTests);
    return args;
  }
  const fileArgs = bunTestFileArgs(testScript);
  if (fileArgs.length > 0) {
    args.push(...fileArgs);
  } else if (hasSrcDir) {
    args.push("src");
  } else {
    args.push("./**/*.test.ts", "./**/*.test.tsx");
  }
  return args;
};

export const workspaceDepsCompileArgs = ({
  packageRoot,
  repoRoot,
}: {
  packageRoot: string;
  repoRoot: string;
}): string[] => {
  return [join(repoRoot, ".github/scripts/compile-workspace-deps.js"), packageRoot];
};

const compilePackageWorkspaceDeps = ({
  packageRoot,
  repoRoot,
}: {
  packageRoot: string;
  repoRoot: string;
}): void => {
  if (!packageNeedsCompiledDistDeps(packageRoot)) {
    console.info(`Skipping workspace dist compile for ${packageRoot} (no @terreno dist imports)`);
    return;
  }
  execFileSync("node", workspaceDepsCompileArgs({packageRoot, repoRoot}), {
    cwd: repoRoot,
    stdio: "inherit",
  });
};

/**
 * Package `test` scripts rely on the shell to expand globs such as `./**\/*.test.ts`.
 * Coverage runs spawn `bun` directly, so expand the patterns here; an unexpanded pattern
 * reaches bun as a literal filter, matches nothing, and exits non-zero.
 */
export const expandCoverageRunArgs = ({
  args,
  packageRoot,
}: {
  args: readonly string[];
  packageRoot: string;
}): string[] => {
  return args.flatMap((arg) => {
    if (!arg.includes("*")) {
      return [arg];
    }
    const matches = [
      ...new Bun.Glob(arg.replace(/^\.\//, "")).scanSync({
        cwd: packageRoot,
        onlyFiles: true,
      }),
    ]
      .filter((match) => !normalizePath(match).split("/").includes("node_modules"))
      .sort();
    return matches;
  });
};

const readPackageTestScript = (packageRoot: string): string | undefined => {
  const packageJsonPath = join(packageRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts?: {test?: string};
  };
  return packageJson.scripts?.test;
};

const runPackageCoverage = async ({
  coverageDir,
  newSourceFiles,
  packageName,
  packageRoot,
  repoRoot,
}: {
  coverageDir: string;
  newSourceFiles: readonly string[];
  packageName: string;
  packageRoot: string;
  repoRoot: string;
}): Promise<{exitCode: number; output: string}> => {
  compilePackageWorkspaceDeps({packageRoot, repoRoot});
  const colocatedTests = findColocatedTests({
    files: newSourceFiles,
    packageRoot,
    repoRoot,
  });
  if (colocatedTests) {
    console.info(`Running colocated tests for ${packageName}: ${colocatedTests.join(", ")}`);
  } else {
    console.info(
      `No colocated tests for every new file in ${packageName}; running the package suite`
    );
  }
  const coverageArgs = expandCoverageRunArgs({
    args: coverageRunArgs({
      colocatedTests,
      hasSrcDir: existsSync(join(packageRoot, "src")),
      packageName,
      testScript: readPackageTestScript(packageRoot),
    }),
    packageRoot,
  });
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      "bun",
      [
        "test",
        ...coverageArgs,
        "--coverage",
        "--coverage-reporter=text",
        "--coverage-reporter=lcov",
        `--coverage-dir=${coverageDir}`,
      ],
      {
        cwd: packageRoot,
        env: {...process.env, CI: "true", FORCE_COLOR: "0"},
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({exitCode: code ?? 1, output});
    });
  });
};

const reportFailures = (failures: NewFileCoverageFailure[], threshold: number): void => {
  if (failures.length === 0) {
    console.info(`\nEvery new source file meets the ${threshold}% coverage threshold.`);
    return;
  }

  console.error(`\nNew source files below ${threshold}% coverage:`);
  for (const failure of failures) {
    if (!failure.summary) {
      console.error(`- ${failure.path}: absent from LCOV (0% coverage)`);
      continue;
    }
    console.error(
      `- ${failure.path}: functions=${failure.summary.functions.toFixed(2)}%, ` +
        `lines=${failure.summary.lines.toFixed(2)}%`
    );
  }
  process.exit(1);
};

const main = async (): Promise<void> => {
  const {base, lcovPath, packageName, skipPackages, threshold} = parseNewFileCoverageArgs(
    process.argv.slice(2)
  );
  if (!base) {
    console.error("Missing required --base=<git-sha> argument.");
    process.exit(1);
  }
  if (lcovPath && !packageName) {
    console.error("--lcov requires --package=<workspace>.");
    process.exit(1);
  }

  const repoRoot = resolve(import.meta.dir, "..");
  const skipSet = new Set(skipPackages);
  const files = getAddedSourceFiles(repoRoot, base);
  let packages = groupFilesByWorkspace({
    files,
    workspaces: getWorkspaceNames(repoRoot),
  });
  if (packageName) {
    packages = packages.filter((entry) => entry.packageName === packageName);
  }
  const skipped = packages.filter((entry) => skipSet.has(entry.packageName));
  for (const entry of skipped) {
    console.info(
      `Skipping ${entry.packageName}: package CI already ran test:coverage (${entry.files.length} new file(s)).`
    );
  }
  packages = packages.filter((entry) => !skipSet.has(entry.packageName));
  if (packages.length === 0) {
    console.info("No new workspace source files require coverage.");
    return;
  }

  if (lcovPath) {
    const packageCoverage = packages[0];
    if (!packageCoverage) {
      console.info("No new workspace source files require coverage.");
      return;
    }
    const absoluteLcov = resolve(repoRoot, lcovPath);
    if (!existsSync(absoluteLcov)) {
      console.error(`LCOV not found at ${absoluteLcov}`);
      process.exit(1);
    }
    const packageRoot = join(repoRoot, packageCoverage.packageName);
    const coverage = parseLcov(readFileSync(absoluteLcov, "utf8"), packageRoot);
    reportFailures(
      evaluateNewFileCoverage({
        coverage,
        files: packageCoverage.files,
        packageRoot,
        repoRoot,
        threshold,
      }),
      threshold
    );
    return;
  }

  const allFailures: NewFileCoverageFailure[] = [];
  for (const packageCoverage of packages) {
    const packageRoot = join(repoRoot, packageCoverage.packageName);
    const coverageDir = mkdtempSync(join(tmpdir(), `terreno-${packageCoverage.packageName}-`));
    try {
      console.info(
        `\nChecking ${packageCoverage.files.length} new source file(s) in ${packageCoverage.packageName}...`
      );
      const {exitCode, output} = await runPackageCoverage({
        coverageDir,
        newSourceFiles: packageCoverage.files,
        packageName: packageCoverage.packageName,
        packageRoot,
        repoRoot,
      });
      if (exitCode !== 0 && !isBunCoverageThresholdExit(exitCode, output)) {
        process.exit(exitCode);
      }
      const generatedLcov = join(coverageDir, "lcov.info");
      const coverage = existsSync(generatedLcov)
        ? parseLcov(readFileSync(generatedLcov, "utf8"))
        : new Map<string, FileCoverage>();
      allFailures.push(
        ...evaluateNewFileCoverage({
          coverage,
          files: packageCoverage.files,
          packageRoot,
          repoRoot,
          threshold,
        })
      );
    } finally {
      rmSync(coverageDir, {force: true, recursive: true});
    }
  }

  reportFailures(allFailures, threshold);
};

if (import.meta.main) {
  void main();
}
