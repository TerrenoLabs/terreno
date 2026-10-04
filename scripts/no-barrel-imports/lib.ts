import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");

export const SCAN_ROOTS = [
  "admin-backend/src",
  "admin-frontend/src",
  "admin-spa",
  "ai/src",
  "api/src",
  "api-health/src",
  "blocks/src",
  "cli/src",
  "comms/src",
  "demo",
  "example-backend/src",
  "example-frontend",
  "feature-flags/src",
  "jobs/src",
  "mcp-server/src",
  "rtk/src",
  "test/src",
  "ui/src",
] as const;

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".expo",
  ".next",
  "generated",
  "vendor",
]);

/** Package name → absolute path to the package public entry index file. */
export const PACKAGE_PUBLIC_ENTRIES: Record<string, string> = {
  "@terreno/admin-backend": resolve(REPO_ROOT, "admin-backend/src/index.ts"),
  "@terreno/admin-frontend": resolve(REPO_ROOT, "admin-frontend/src/index.tsx"),
  "@terreno/admin-spa": resolve(REPO_ROOT, "admin-spa/src/index.ts"),
  "@terreno/ai": resolve(REPO_ROOT, "ai/src/index.ts"),
  "@terreno/api": resolve(REPO_ROOT, "api/src/index.ts"),
  "@terreno/api-health": resolve(REPO_ROOT, "api-health/src/index.ts"),
  "@terreno/blocks": resolve(REPO_ROOT, "blocks/src/index.ts"),
  "@terreno/cli": resolve(REPO_ROOT, "cli/src/index.ts"),
  "@terreno/comms": resolve(REPO_ROOT, "comms/src/index.ts"),
  "@terreno/feature-flags": resolve(REPO_ROOT, "feature-flags/src/index.ts"),
  "@terreno/jobs": resolve(REPO_ROOT, "jobs/src/index.ts"),
  "@terreno/mcp": resolve(REPO_ROOT, "mcp-server/src/index.ts"),
  "@terreno/rtk": resolve(REPO_ROOT, "rtk/src/index.ts"),
  "@terreno/test": resolve(REPO_ROOT, "test/src/index.ts"),
  "@terreno/ui": resolve(REPO_ROOT, "ui/src/index.tsx"),
};

const IMPORT_EXPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/g;

const REEXPORT_PATTERN = /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]+\})\s+from\s+["']\./m;

export interface BarrelViolation {
  file: string;
  importPath: string;
  line: number;
  resolvedBarrel: string;
}

interface PathAliasMap {
  [alias: string]: string[];
}

const isSourceFile = (filePath: string): boolean => /\.(t|j)sx?$/.test(filePath);

const shouldSkipDirectory = (dirName: string): boolean => {
  return IGNORED_DIR_NAMES.has(dirName) || dirName.startsWith(".");
};

const walkSourceFiles = (directory: string, files: string[] = []): string[] => {
  if (!existsSync(directory)) {
    return files;
  }

  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (shouldSkipDirectory(entry)) {
        continue;
      }
      walkSourceFiles(fullPath, files);
      continue;
    }
    if (isSourceFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
};

const readTsconfigPathAliases = (packageDir: string): PathAliasMap => {
  const tsconfigPath = join(packageDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    return {};
  }

  try {
    const raw = readFileSync(tsconfigPath, "utf8");
    const withoutLineComments = raw.replace(/^\s*\/\/.*$/gm, "");
    const withoutTrailingCommas = withoutLineComments.replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(withoutTrailingCommas) as {
      compilerOptions?: {baseUrl?: string; paths?: Record<string, string[]>};
    };
    const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
    const paths = parsed.compilerOptions?.paths ?? {};
    const resolved: PathAliasMap = {};

    for (const [aliasPattern, targets] of Object.entries(paths)) {
      const alias = aliasPattern.replace(/\/\*$/, "");
      resolved[alias] = targets.map((target) =>
        resolve(packageDir, baseUrl, target.replace(/\/\*$/, ""))
      );
    }

    return resolved;
  } catch {
    return {};
  }
};

const loadPathAliases = (repoRoot: string = REPO_ROOT): Map<string, PathAliasMap> => {
  const packagesWithAliases = ["example-frontend", "admin-spa", "demo"];
  const aliasByPackageDir = new Map<string, PathAliasMap>();

  for (const pkg of packagesWithAliases) {
    aliasByPackageDir.set(resolve(repoRoot, pkg), readTsconfigPathAliases(resolve(repoRoot, pkg)));
  }

  return aliasByPackageDir;
};

const findOwningPackageDir = (filePath: string, repoRoot: string): string | null => {
  let current = dirname(filePath);
  while (current.startsWith(repoRoot)) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
};

const resolveImportBase = (
  importPath: string,
  fromFile: string,
  aliasByPackageDir: Map<string, PathAliasMap>,
  repoRoot: string = REPO_ROOT
): string | null => {
  if (importPath.startsWith("@terreno/")) {
    const entry = PACKAGE_PUBLIC_ENTRIES[importPath.split("/testing")[0] ?? importPath];
    if (importPath.endsWith("/testing")) {
      const testingEntry: Record<string, string> = {
        "@terreno/api": resolve(repoRoot, "api/src/tests.ts"),
      };
      return testingEntry[importPath] ?? null;
    }
    return entry ?? null;
  }

  if (importPath.startsWith("@/")) {
    const packageDir = findOwningPackageDir(fromFile, repoRoot);
    if (!packageDir) {
      return null;
    }
    const aliases = aliasByPackageDir.get(packageDir) ?? {};
    const remainder = importPath.slice(2);
    const rootAlias = aliases["@"]?.[0];
    if (!rootAlias) {
      return null;
    }
    return resolve(rootAlias, remainder);
  }

  if (importPath.startsWith("@")) {
    const packageDir = findOwningPackageDir(fromFile, repoRoot);
    if (!packageDir) {
      return null;
    }
    const aliases = aliasByPackageDir.get(packageDir) ?? {};
    for (const [alias, targets] of Object.entries(aliases)) {
      if (importPath === alias || importPath.startsWith(`${alias}/`)) {
        const targetRoot = targets[0];
        if (!targetRoot) {
          return null;
        }
        const suffix = importPath.slice(alias.length).replace(/^\//, "");
        return suffix ? resolve(targetRoot, suffix) : targetRoot;
      }
    }
    return null;
  }

  if (!importPath.startsWith(".")) {
    return null;
  }

  return resolve(dirname(fromFile), importPath);
};

const resolveModulePath = (basePath: string): string | null => {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    join(basePath, "index.ts"),
    join(basePath, "index.tsx"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
};

const isExpoRouteIndex = (filePath: string): boolean => {
  return /\/app\//.test(filePath) && /\/index\.tsx?$/.test(filePath);
};

const isPackagePublicEntry = (filePath: string, repoRoot: string = REPO_ROOT): boolean => {
  if (Object.values(PACKAGE_PUBLIC_ENTRIES).includes(filePath)) {
    return true;
  }
  // Package public entries live at <package>/src/index.ts(x) relative to the repo root.
  const relativePath = relative(repoRoot, filePath).replace(/\\/g, "/");
  return /^[^/]+\/src\/index\.tsx?$/.test(relativePath);
};

const isBarrelIndexFile = (filePath: string, repoRoot: string = REPO_ROOT): boolean => {
  if (!/\/index\.tsx?$/.test(filePath)) {
    return false;
  }
  if (isExpoRouteIndex(filePath)) {
    return false;
  }
  if (isPackagePublicEntry(filePath, repoRoot)) {
    return false;
  }

  const contents = readFileSync(filePath, "utf8");
  if (!REEXPORT_PATTERN.test(contents)) {
    return false;
  }

  return true;
};

const isAllowedPublicPackageImport = (importPath: string, resolvedPath: string): boolean => {
  if (!importPath.startsWith("@terreno/")) {
    return false;
  }
  if (importPath === "@terreno/api/testing") {
    return resolve(REPO_ROOT, "api/src/tests.ts") === resolvedPath;
  }
  const publicEntry = PACKAGE_PUBLIC_ENTRIES[importPath];
  return publicEntry === resolvedPath;
};

const findViolationsInFile = (
  filePath: string,
  aliasByPackageDir: Map<string, PathAliasMap>,
  repoRoot: string
): BarrelViolation[] => {
  const contents = readFileSync(filePath, "utf8");
  const lines = contents.split("\n");
  const violations: BarrelViolation[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      continue;
    }

    for (const match of line.matchAll(IMPORT_EXPORT_PATTERN)) {
      const importPath = match[1];
      if (!importPath) {
        continue;
      }

      const base = resolveImportBase(importPath, filePath, aliasByPackageDir, repoRoot);
      if (!base) {
        continue;
      }

      const resolved = resolveModulePath(base);
      if (!resolved || !isBarrelIndexFile(resolved, repoRoot)) {
        continue;
      }

      if (isAllowedPublicPackageImport(importPath, resolved)) {
        continue;
      }

      violations.push({
        file: relative(repoRoot, filePath),
        importPath,
        line: lineIndex + 1,
        resolvedBarrel: relative(repoRoot, resolved),
      });
    }
  }

  return violations;
};

export const collectBarrelImportViolations = (
  repoRoot: string = REPO_ROOT,
  scanRoots: readonly string[] = SCAN_ROOTS
): BarrelViolation[] => {
  const aliasByPackageDir = loadPathAliases(repoRoot);
  const files: string[] = [];

  for (const scanRoot of scanRoots) {
    walkSourceFiles(resolve(repoRoot, scanRoot), files);
  }

  const violations: BarrelViolation[] = [];
  for (const file of files) {
    if (isBarrelIndexFile(file, repoRoot)) {
      continue;
    }
    if (isPackagePublicEntry(file, repoRoot)) {
      continue;
    }
    violations.push(...findViolationsInFile(file, aliasByPackageDir, repoRoot));
  }

  return violations.sort((a, b) => {
    if (a.file === b.file) {
      return a.line - b.line;
    }
    return a.file.localeCompare(b.file);
  });
};

export const collectInternalBarrelIndexFiles = (
  repoRoot: string = REPO_ROOT,
  scanRoots: readonly string[] = SCAN_ROOTS
): string[] => {
  const files: string[] = [];
  for (const scanRoot of scanRoots) {
    walkSourceFiles(resolve(repoRoot, scanRoot), files);
  }

  return files
    .filter((file) => isBarrelIndexFile(file, repoRoot))
    .map((file) => relative(repoRoot, file))
    .sort();
};
