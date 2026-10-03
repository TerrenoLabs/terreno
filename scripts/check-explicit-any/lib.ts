import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import {join, relative, resolve} from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../..");

const requireFromApi = createRequire(join(REPO_ROOT, "api/package.json"));
const ts = requireFromApi("typescript") as typeof import("typescript");

export const SCAN_ROOTS = [
  "admin-backend/src",
  "admin-frontend/src",
  "admin-spa",
  "ai/src",
  "api/src",
  "api-health/src",
  "blocks/src",
  "comms/src",
  "demo",
  "example-backend/src",
  "example-frontend",
  "feature-flags/src",
  "jobs/src",
  "mcp-server/src",
  "rtk/src",
  "scripts",
  "syncdb/src",
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
  ".docusaurus",
  ".git",
]);

const BIOME_IGNORE_LINE_PATTERN = /biome-ignore(?:-all)?\s+lint\/suspicious\/noExplicitAny/;
const NO_EXPLICIT_ANY_PATTERN = /\/\/\s*noExplicitAny:/;

const DEFAULT_EXCLUDED_FILE_NAMES = new Set(["commsOpenApiSdk.ts", "openApiSdk.ts"]);

const DEFAULT_EXCLUDED_FILE_PATTERNS = [/\.template\.tsx?$/, /\/openApiSdk\.ts$/];

type AnyUsageKind = "annotation" | "cast" | "generic" | "index-signature";

export type RemediationStatus =
  | "violation"
  | "fully-documented"
  | "suppressed-only"
  | "file-blanket"
  | "out-of-scope";

interface AnyUsage {
  column: number;
  file: string;
  hasBiomeIgnore: boolean;
  hasNoExplicitAnyComment: boolean;
  isExcludedFromBiome: boolean;
  isTestFile: boolean;
  kind: AnyUsageKind;
  line: number;
  packageName: string;
  remediationStatus: RemediationStatus;
  snippet: string;
  suppressionScope: "line" | "file" | "none";
}

export interface AnyAuditSummary {
  byPackage: Record<string, number>;
  byRemediationStatus: Record<RemediationStatus, number>;
  fileBlanketFiles: number;
  totalFiles: number;
  totalUsages: number;
  usages: AnyUsage[];
}

export interface CollectAnyUsagesOptions {
  includeExcluded?: boolean;
  packageFilter?: string;
  repoRoot?: string;
  scanRoots?: readonly string[];
  undocumentedOnly?: boolean;
}

interface FileSuppressionContext {
  fileLevelBiomeIgnore: boolean;
  fileLevelNoExplicitAny: boolean;
  lines: string[];
}

const isSourceFile = (filePath: string): boolean => /\.tsx?$/.test(filePath);

const shouldSkipDirectory = (dirName: string): boolean => {
  return IGNORED_DIR_NAMES.has(dirName) || dirName.startsWith(".");
};

export const walkSourceFiles = (directory: string, files: string[] = []): string[] => {
  if (!existsSync(directory)) {
    return files;
  }

  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    // Broken symlinks (e.g. stale CocoaPods headers) stat to undefined; skip them.
    const stats = statSync(fullPath, {throwIfNoEntry: false});
    if (!stats) {
      continue;
    }
    if (stats.isDirectory()) {
      if (shouldSkipDirectory(entry)) {
        continue;
      }
      walkSourceFiles(fullPath, files);
      continue;
    }
    if (!isSourceFile(fullPath)) {
      continue;
    }
    if (DEFAULT_EXCLUDED_FILE_NAMES.has(entry)) {
      continue;
    }
    if (DEFAULT_EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(fullPath))) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
};

const GLOBSTAR_PLACEHOLDER = "{{GLOBSTAR}}";

const globToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replace(/\\/g, "/");
  const regexBody = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, GLOBSTAR_PLACEHOLDER)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(GLOBSTAR_PLACEHOLDER, "g"), ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexBody}$`);
};

const loadBiomeExclusionPatterns = (repoRoot: string = REPO_ROOT): RegExp[] => {
  const patterns: string[] = [];
  const biomeConfigs = [
    join(repoRoot, "biome.jsonc"),
    ...readdirSync(repoRoot, {withFileTypes: true})
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(repoRoot, entry.name, "biome.jsonc"))
      )
      .map((entry) => join(repoRoot, entry.name, "biome.jsonc")),
  ];

  for (const configPath of biomeConfigs) {
    if (!existsSync(configPath)) {
      continue;
    }
    const isRootConfig = configPath === join(repoRoot, "biome.jsonc");
    const packagePrefix = isRootConfig
      ? ""
      : `${relative(repoRoot, configPath).replace(/\/biome\.jsonc$/, "")}/`;
    const contents = readFileSync(configPath, "utf8");
    for (const match of contents.matchAll(/!!([^",\s]+)/g)) {
      const pattern = match[1];
      if (pattern) {
        patterns.push(`${packagePrefix}${pattern}`);
      }
    }
  }

  return [...new Set(patterns)].map(globToRegExp);
};

export const isExcludedFromBiome = (
  relativeFilePath: string,
  exclusionPatterns: RegExp[]
): boolean => {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  return exclusionPatterns.some((pattern) => pattern.test(normalized));
};

export const inferPackageName = (relativeFilePath: string): string => {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  const [first, second] = normalized.split("/");
  if (!first) {
    return "unknown";
  }
  if (first === "example-backend" || first === "example-frontend") {
    return first;
  }
  if (second === "src" || second === "app" || second === "store" || second === "components") {
    return first;
  }
  return first;
};

export const isTestFile = (relativeFilePath: string): boolean => {
  const normalized = relativeFilePath.replace(/\\/g, "/");
  return (
    /\.(test|isolated)\.[tj]sx?$/.test(normalized) ||
    normalized.includes("/tests/") ||
    normalized.includes("/e2e/") ||
    normalized.includes("/__tests__/")
  );
};

const classifyAnyUsage = (node: ts.Node): AnyUsageKind => {
  const parent = node.parent;
  if (ts.isAsExpression(parent) && parent.type === node) {
    return "cast";
  }
  if (parent && ts.isTypeReferenceNode(parent)) {
    return "generic";
  }
  if (ts.isIndexSignatureDeclaration(parent) && parent.type === node) {
    return "index-signature";
  }
  return "annotation";
};

const parseFileSuppressionContext = (contents: string): FileSuppressionContext => {
  const lines = contents.split("\n");
  let fileLevelBiomeIgnore = false;
  let fileLevelNoExplicitAny = false;

  for (let index = 0; index < Math.min(lines.length, 40); index++) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*")) {
      break;
    }
    if (BIOME_IGNORE_LINE_PATTERN.test(line)) {
      if (line.includes("biome-ignore-all")) {
        fileLevelBiomeIgnore = true;
      }
    }
    if (NO_EXPLICIT_ANY_PATTERN.test(line)) {
      fileLevelNoExplicitAny = true;
    }
  }

  return {
    fileLevelBiomeIgnore,
    fileLevelNoExplicitAny,
    lines,
  };
};

const lineHasBiomeIgnore = (lines: string[], lineNumber: number): boolean => {
  const candidates = [lineNumber - 1, lineNumber - 2, lineNumber];
  for (const candidate of candidates) {
    if (candidate < 1 || candidate > lines.length) {
      continue;
    }
    const line = lines[candidate - 1] ?? "";
    if (BIOME_IGNORE_LINE_PATTERN.test(line) && !line.includes("biome-ignore-all")) {
      return true;
    }
  }
  return false;
};

const lineHasNoExplicitAnyComment = (lines: string[], lineNumber: number): boolean => {
  const candidates = [lineNumber - 1, lineNumber - 2, lineNumber];
  for (const candidate of candidates) {
    if (candidate < 1 || candidate > lines.length) {
      continue;
    }
    const line = lines[candidate - 1] ?? "";
    if (NO_EXPLICIT_ANY_PATTERN.test(line)) {
      return true;
    }
  }
  return false;
};

const resolveRemediationStatus = ({
  excludedFromBiome,
  fileLevelBiomeIgnore,
  fileLevelNoExplicitAny,
  hasBiomeIgnore,
  hasNoExplicitAnyComment,
}: {
  excludedFromBiome: boolean;
  fileLevelBiomeIgnore: boolean;
  fileLevelNoExplicitAny: boolean;
  hasBiomeIgnore: boolean;
  hasNoExplicitAnyComment: boolean;
}): RemediationStatus => {
  if (excludedFromBiome) {
    return "out-of-scope";
  }
  if (fileLevelBiomeIgnore) {
    if (fileLevelNoExplicitAny) {
      return "fully-documented";
    }
    return "file-blanket";
  }
  if (hasBiomeIgnore && hasNoExplicitAnyComment) {
    return "fully-documented";
  }
  if (hasBiomeIgnore) {
    return "suppressed-only";
  }
  return "violation";
};

const collectAnyUsagesInFile = (
  absoluteFilePath: string,
  repoRoot: string,
  exclusionPatterns: RegExp[]
): AnyUsage[] => {
  const relativeFilePath = relative(repoRoot, absoluteFilePath).replace(/\\/g, "/");
  const contents = readFileSync(absoluteFilePath, "utf8");
  const sourceFile = ts.createSourceFile(
    absoluteFilePath,
    contents,
    ts.ScriptTarget.Latest,
    true,
    absoluteFilePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const suppression = parseFileSuppressionContext(contents);
  const excludedFromBiome = isExcludedFromBiome(relativeFilePath, exclusionPatterns);
  const packageName = inferPackageName(relativeFilePath);
  const testFile = isTestFile(relativeFilePath);
  const usages: AnyUsage[] = [];

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const {line, character} = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const lineNumber = line + 1;
      const column = character + 1;
      const snippet = (suppression.lines[line] ?? "").trim();
      const hasLineBiomeIgnore = lineHasBiomeIgnore(suppression.lines, lineNumber);
      const hasLineNoExplicitAny = lineHasNoExplicitAnyComment(suppression.lines, lineNumber);
      const hasBiomeIgnore = suppression.fileLevelBiomeIgnore || hasLineBiomeIgnore;
      const hasNoExplicitAnyComment = suppression.fileLevelNoExplicitAny || hasLineNoExplicitAny;
      const suppressionScope: AnyUsage["suppressionScope"] = suppression.fileLevelBiomeIgnore
        ? "file"
        : hasLineBiomeIgnore
          ? "line"
          : "none";
      const remediationStatus = resolveRemediationStatus({
        excludedFromBiome,
        fileLevelBiomeIgnore: suppression.fileLevelBiomeIgnore,
        fileLevelNoExplicitAny: suppression.fileLevelNoExplicitAny,
        hasBiomeIgnore,
        hasNoExplicitAnyComment,
      });

      usages.push({
        column,
        file: relativeFilePath,
        hasBiomeIgnore,
        hasNoExplicitAnyComment,
        isExcludedFromBiome: excludedFromBiome,
        isTestFile: testFile,
        kind: classifyAnyUsage(node),
        line: lineNumber,
        packageName,
        remediationStatus,
        snippet,
        suppressionScope,
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return usages;
};

export const collectAnyUsages = ({
  includeExcluded = false,
  packageFilter,
  repoRoot = REPO_ROOT,
  scanRoots = SCAN_ROOTS,
  undocumentedOnly = false,
}: CollectAnyUsagesOptions = {}): AnyAuditSummary => {
  const exclusionPatterns = loadBiomeExclusionPatterns(repoRoot);
  const files: string[] = [];

  for (const scanRoot of scanRoots) {
    walkSourceFiles(resolve(repoRoot, scanRoot), files);
  }

  const usages: AnyUsage[] = [];
  for (const file of files.sort()) {
    usages.push(...collectAnyUsagesInFile(file, repoRoot, exclusionPatterns));
  }

  const filteredUsages = usages.filter((usage) => {
    if (packageFilter && usage.packageName !== packageFilter) {
      return false;
    }
    if (!includeExcluded && usage.isExcludedFromBiome) {
      return false;
    }
    if (undocumentedOnly) {
      return (
        usage.remediationStatus === "suppressed-only" || usage.remediationStatus === "file-blanket"
      );
    }
    return true;
  });

  const byPackage: Record<string, number> = {};
  const byRemediationStatus: Record<RemediationStatus, number> = {
    "file-blanket": 0,
    "fully-documented": 0,
    "out-of-scope": 0,
    "suppressed-only": 0,
    violation: 0,
  };

  const fileBlanketFiles = new Set<string>();
  for (const usage of filteredUsages) {
    byPackage[usage.packageName] = (byPackage[usage.packageName] ?? 0) + 1;
    byRemediationStatus[usage.remediationStatus] += 1;
    if (usage.remediationStatus === "file-blanket") {
      fileBlanketFiles.add(usage.file);
    }
  }

  return {
    byPackage,
    byRemediationStatus,
    fileBlanketFiles: fileBlanketFiles.size,
    totalFiles: new Set(filteredUsages.map((usage) => usage.file)).size,
    totalUsages: filteredUsages.length,
    usages: filteredUsages,
  };
};

export interface CheckExplicitAnyCliOptions {
  baselinePath?: string;
  checkBaseline?: boolean;
  failOnUndocumented?: boolean;
  includeExcluded?: boolean;
  json?: boolean;
  list?: boolean;
  maxCount?: number;
  packageFilter?: string;
  productionOnly?: boolean;
  repoRoot?: string;
  undocumentedOnly?: boolean;
  writeBaseline?: boolean;
}

export interface CheckExplicitAnyResult {
  exitCode: number;
  summary: AnyAuditSummary;
  text: string;
}

export const formatSummaryText = (summary: AnyAuditSummary): string => {
  const packageLines = Object.entries(summary.byPackage)
    .sort((left, right) => right[1] - left[1])
    .map(([packageName, count]) => `  ${packageName.padEnd(22)} ${count}`)
    .join("\n");

  return [
    `check-explicit-any: ${summary.totalUsages} usages across ${summary.totalFiles} files`,
    "",
    `  violations:           ${summary.byRemediationStatus.violation}`,
    `  fully documented:     ${summary.byRemediationStatus["fully-documented"]}`,
    `  suppressed only:      ${summary.byRemediationStatus["suppressed-only"]}`,
    `  file blanket:         ${summary.byRemediationStatus["file-blanket"]} (${summary.fileBlanketFiles} files)`,
    `  out of lint scope:    ${summary.byRemediationStatus["out-of-scope"]}`,
    "",
    "By package:",
    packageLines || "  (none)",
  ].join("\n");
};

export const formatUsageListText = (summary: AnyAuditSummary): string => {
  if (summary.usages.length === 0) {
    return "check-explicit-any: no matching usages";
  }

  return summary.usages
    .map(
      (usage) =>
        `${usage.file}:${usage.line}:${usage.column} ${usage.kind} ${usage.remediationStatus}${usage.isTestFile ? " [test]" : ""}`
    )
    .join("\n");
};

export const runCheckExplicitAny = ({
  baselinePath,
  checkBaseline = false,
  failOnUndocumented = false,
  includeExcluded = false,
  json = false,
  list = false,
  maxCount,
  packageFilter,
  productionOnly = false,
  repoRoot = REPO_ROOT,
  undocumentedOnly = false,
  writeBaseline = false,
}: CheckExplicitAnyCliOptions = {}): CheckExplicitAnyResult => {
  let summary = collectAnyUsages({
    includeExcluded,
    packageFilter,
    repoRoot,
    undocumentedOnly,
  });

  if (productionOnly) {
    summary = {
      ...summary,
      usages: summary.usages.filter((usage) => !usage.isTestFile),
    };
    summary.totalUsages = summary.usages.length;
    summary.totalFiles = new Set(summary.usages.map((usage) => usage.file)).size;
    summary.byPackage = {};
    summary.byRemediationStatus = {
      "file-blanket": 0,
      "fully-documented": 0,
      "out-of-scope": 0,
      "suppressed-only": 0,
      violation: 0,
    };
    summary.fileBlanketFiles = 0;
    const fileBlanketFileSet = new Set<string>();
    for (const usage of summary.usages) {
      summary.byPackage[usage.packageName] = (summary.byPackage[usage.packageName] ?? 0) + 1;
      summary.byRemediationStatus[usage.remediationStatus] += 1;
      if (usage.remediationStatus === "file-blanket") {
        fileBlanketFileSet.add(usage.file);
      }
    }
    summary.fileBlanketFiles = fileBlanketFileSet.size;
  }

  const violations = summary.byRemediationStatus.violation;
  const undocumented =
    summary.byRemediationStatus["suppressed-only"] + summary.byRemediationStatus["file-blanket"];

  let exitCode = 0;
  let text = "";

  if (json) {
    text = JSON.stringify(summary, null, 2);
  } else if (list) {
    text = formatUsageListText(summary);
  } else {
    text = formatSummaryText(summary);
  }

  if (writeBaseline) {
    const {BASELINE_PATH, writeBaseline: persistBaseline} =
      require("./baseline") as typeof import("./baseline");
    persistBaseline(summary, baselinePath);
    if (!json && !list) {
      text = `${text}\n\nWrote baseline to ${baselinePath ?? BASELINE_PATH}`;
    }
  }

  if (checkBaseline) {
    const {compareBaseline, formatBaselineRegressionText, loadBaseline} =
      require("./baseline") as typeof import("./baseline");
    const baseline = loadBaseline(baselinePath);
    const comparison = compareBaseline(summary, baseline);
    if (!comparison.ok) {
      exitCode = 1;
      if (!json && !list) {
        text = `${text}\n\n${formatBaselineRegressionText(comparison)}`;
      }
    } else if (!json && !list) {
      text = `${text}\n\n${formatBaselineRegressionText(comparison)}`;
    }
  }

  if (violations > 0) {
    exitCode = 1;
  }
  if (failOnUndocumented && undocumented > 0) {
    exitCode = 1;
  }
  if (maxCount !== undefined && summary.totalUsages > maxCount) {
    exitCode = 1;
    if (!json && !list) {
      text = `${text}\n\ncheck-explicit-any: totalUsages ${summary.totalUsages} exceeds --max-count=${maxCount}`;
    }
  }

  return {
    exitCode,
    summary,
    text,
  };
};
