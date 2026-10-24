import {existsSync, readdirSync, statSync} from "node:fs";
import path from "node:path";

/** Glob patterns (relative to the working directory) that identify a test file by default. */
export const DEFAULT_TEST_PATTERNS: readonly string[] = ["**/*.test.ts", "**/*.test.tsx"];

/**
 * Directory names skipped at any depth while walking. Build output, native projects, and
 * Playwright `e2e/` suites are never `bun test` files, and walking `node_modules` is slow.
 */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
  ".expo",
  ".git",
  "android",
  "build",
  "coverage",
  "dist",
  "e2e",
  "ios",
  "node_modules",
];

export interface CollectFilesOptions {
  /** Files or directories to search, absolute or relative to `cwd`. */
  paths: string[];
  /** Directory that patterns and returned paths are relative to. */
  cwd: string;
  /** Globs matched against each file's `cwd`-relative POSIX path. Defaults to `DEFAULT_TEST_PATTERNS`. */
  patterns?: readonly string[];
  /** Directory names skipped at any depth. Defaults to `DEFAULT_EXCLUDED_DIRS`. */
  excludeDirs?: readonly string[];
  /** Globs matched against each file's `cwd`-relative POSIX path; matches are dropped. */
  exclude?: readonly string[];
}

export interface CollectFilesResult {
  /** Sorted, de-duplicated `cwd`-relative POSIX paths. */
  files: string[];
  /** Input paths that do not exist. */
  missingPaths: string[];
}

/** Converts a native path to forward-slash form so globs and output are platform independent. */
export const toPosixPath = (filePath: string): string => filePath.replaceAll("\\", "/");

/** Returns whether `filePath` matches at least one glob. */
export const matchesAnyGlob = ({
  filePath,
  globs,
}: {
  filePath: string;
  globs: readonly string[];
}): boolean => globs.some((glob) => new Bun.Glob(glob).match(filePath));

const walkFiles = ({
  dir,
  excludeDirs,
  out,
}: {
  dir: string;
  excludeDirs: ReadonlySet<string>;
  out: string[];
}): void => {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (excludeDirs.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles({dir: fullPath, excludeDirs, out});
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
};

/**
 * Recursively collects files under `paths` whose `cwd`-relative path matches `patterns`,
 * skipping excluded directory names and `exclude` globs. Discovery is filesystem driven so a
 * newly added file is always picked up without editing a hand-maintained list.
 */
export const collectFiles = ({
  paths,
  cwd,
  patterns = DEFAULT_TEST_PATTERNS,
  excludeDirs = DEFAULT_EXCLUDED_DIRS,
  exclude = [],
}: CollectFilesOptions): CollectFilesResult => {
  const excludedDirNames = new Set(excludeDirs);
  const missingPaths: string[] = [];
  const absoluteFiles: string[] = [];

  for (const target of paths) {
    const absoluteTarget = path.resolve(cwd, target);
    if (!existsSync(absoluteTarget)) {
      missingPaths.push(target);
      continue;
    }
    if (statSync(absoluteTarget).isFile()) {
      absoluteFiles.push(absoluteTarget);
      continue;
    }
    walkFiles({dir: absoluteTarget, excludeDirs: excludedDirNames, out: absoluteFiles});
  }

  const files = [
    ...new Set(absoluteFiles.map((file) => toPosixPath(path.relative(cwd, file)))),
  ].filter(
    (file) =>
      matchesAnyGlob({filePath: file, globs: patterns}) &&
      !matchesAnyGlob({filePath: file, globs: exclude})
  );

  return {files: files.sort(), missingPaths};
};
