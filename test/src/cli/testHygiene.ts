/**
 * Test-hygiene checker: runs the AST rules in `testHygieneRules.ts` over a tree of test files,
 * honors suppression comments, and compares against a committed baseline so only new
 * violations fail CI.
 *
 * - Suppress one finding with `// test-hygiene-disable-next-line <rule-id>[, <rule-id>] -- reason`
 *   on the line before it.
 * - A baseline is a JSON array of `{file, rule, count}`. For each file/rule pair the first
 *   `count` violations (by line) are tolerated; regenerate it with `--update-baseline`.
 */
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {parseArgs} from "node:util";

import {collectFiles, DEFAULT_EXCLUDED_DIRS, DEFAULT_TEST_PATTERNS} from "./collectFiles";
import {
  DEFAULT_SLEEP_CALLEES,
  HYGIENE_RULE_IDS,
  type HygieneRuleConfig,
  type HygieneRuleId,
  type HygieneViolation,
  runHygieneRules,
} from "./testHygieneRules";

const SUPPRESSION_DIRECTIVE = "test-hygiene-disable-next-line";

/** Config file looked up in the working directory when `--config` is not passed. */
const DEFAULT_CONFIG_FILE = "test-hygiene.config.json";

/** Baseline file, relative to the root, used when the config does not name one. */
const DEFAULT_BASELINE_FILE = "test-hygiene-baseline.json";

export interface BaselineEntry {
  file: string;
  rule: HygieneRuleId;
  count: number;
}

/** JSON config file shape. Relative paths resolve against the config file's directory. */
export interface TestHygieneConfigFile {
  /** Directory scanned, reported against, and used for barrel paths (default: config dir). */
  root?: string;
  /** Files or directories to scan, relative to `root` (default: `["."]`). */
  paths?: string[];
  /** Test file globs relative to `root`. */
  include?: string[];
  /** Root-relative globs to skip. */
  exclude?: string[];
  /** Directory names skipped at any depth, added to the defaults. */
  excludeDirs?: string[];
  /** Baseline path. */
  baseline?: string;
  /** Rule toggles; omitted rules stay on. */
  rules?: Partial<Record<HygieneRuleId, boolean>>;
  barrels?: {
    aliases?: string[];
    paths?: string[];
    allowMockIn?: string[];
  };
  mockHelperModules?: string[];
  realExportGetters?: {
    modules?: string[];
    namePattern?: string;
  };
  sleepCallees?: string[];
}

export interface ResolvedHygieneConfig {
  rootDir: string;
  paths: string[];
  include: string[];
  exclude: string[];
  excludeDirs: string[];
  baselinePath: string;
  rules: HygieneRuleId[];
  ruleConfig: HygieneRuleConfig;
}

const isHygieneRuleId = (value: string): value is HygieneRuleId =>
  (HYGIENE_RULE_IDS as readonly string[]).includes(value);

/**
 * Drops violations whose preceding line carries a matching suppression directive. The directive
 * accepts a comma-separated rule list, followed by an optional `-- reason`.
 */
export const applySuppressions = ({
  sourceText,
  violations,
}: {
  sourceText: string;
  violations: HygieneViolation[];
}): {violations: HygieneViolation[]} => {
  const lines = sourceText.split("\n");
  const directive = new RegExp(`${SUPPRESSION_DIRECTIVE}\\s+([\\w-]+(?:\\s*,\\s*[\\w-]+)*)`, "u");
  return {
    violations: violations.filter((violation) => {
      const precedingLine = lines[violation.line - 2];
      const match = precedingLine?.match(directive);
      if (!match) {
        return true;
      }
      const suppressed = match[1].split(",").map((rule) => rule.trim());
      return !suppressed.includes(violation.ruleId);
    }),
  };
};

/** Parses, runs the enabled rules on, and suppression-filters one file. Filesystem free. */
export const checkTestSource = ({
  fileName,
  sourceText,
  config,
  rules,
}: {
  fileName: string;
  sourceText: string;
  config: HygieneRuleConfig;
  rules?: readonly HygieneRuleId[];
}): {violations: HygieneViolation[]} => {
  const {violations} = runHygieneRules({config, fileName, rules, sourceText});
  return applySuppressions({sourceText, violations});
};

const baselineKey = ({file, rule}: {file: string; rule: string}): string => `${file}::${rule}`;

/** Counts violations per file/rule pair, sorted by file then rule for stable diffs. */
export const buildBaseline = ({
  violations,
}: {
  violations: HygieneViolation[];
}): {entries: BaselineEntry[]} => {
  const counts = new Map<string, BaselineEntry>();
  for (const violation of violations) {
    const key = baselineKey({file: violation.file, rule: violation.ruleId});
    const entry = counts.get(key) ?? {count: 0, file: violation.file, rule: violation.ruleId};
    entry.count += 1;
    counts.set(key, entry);
  }
  const entries = [...counts.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule)
  );
  return {entries};
};

/**
 * Splits violations into new ones (beyond the baseline count for their file/rule pair) and
 * reports baseline entries whose count is now higher than reality, so the baseline can ratchet.
 */
export const diffAgainstBaseline = ({
  violations,
  baseline,
}: {
  violations: HygieneViolation[];
  baseline: BaselineEntry[];
}): {newViolations: HygieneViolation[]; staleEntries: BaselineEntry[]} => {
  const grouped = new Map<string, HygieneViolation[]>();
  for (const violation of violations) {
    const key = baselineKey({file: violation.file, rule: violation.ruleId});
    grouped.set(key, [...(grouped.get(key) ?? []), violation]);
  }
  const allowed = new Map(baseline.map((entry) => [baselineKey(entry), entry.count]));

  const newViolations: HygieneViolation[] = [];
  for (const [key, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.line - b.line);
    newViolations.push(...sorted.slice(allowed.get(key) ?? 0));
  }
  const staleEntries = baseline.filter(
    (entry) => (grouped.get(baselineKey(entry))?.length ?? 0) < entry.count
  );
  return {
    newViolations: newViolations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    staleEntries,
  };
};

/** Parses and validates baseline JSON. */
export const parseBaseline = ({
  text,
}: {
  text: string;
}): {entries: BaselineEntry[]} | {error: string} => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return {error: `Baseline is not valid JSON: ${(error as Error).message}`};
  }
  if (!Array.isArray(data)) {
    return {error: "Baseline must be a JSON array of {file, rule, count}"};
  }
  const entries: BaselineEntry[] = [];
  for (const item of data as unknown[]) {
    const entry = item as Partial<BaselineEntry>;
    if (
      typeof entry?.file !== "string" ||
      typeof entry.rule !== "string" ||
      !isHygieneRuleId(entry.rule) ||
      typeof entry.count !== "number"
    ) {
      return {error: `Invalid baseline entry: ${JSON.stringify(item)}`};
    }
    entries.push({count: entry.count, file: entry.file, rule: entry.rule});
  }
  return {entries};
};

/** Counts violations per rule, including rules with zero findings, in rule order. */
export const countByRule = ({
  violations,
  rules = HYGIENE_RULE_IDS,
}: {
  violations: HygieneViolation[];
  rules?: readonly HygieneRuleId[];
}): {counts: Record<string, number>} => {
  const counts: Record<string, number> = Object.fromEntries(rules.map((rule) => [rule, 0]));
  for (const violation of violations) {
    counts[violation.ruleId] = (counts[violation.ruleId] ?? 0) + 1;
  }
  return {counts};
};

/** Applies defaults and resolves config-file paths against `configDir`. */
export const resolveHygieneConfig = ({
  file = {},
  configDir,
}: {
  file?: TestHygieneConfigFile;
  configDir: string;
}): {config: ResolvedHygieneConfig} => {
  const rootDir = path.resolve(configDir, file.root ?? ".");
  const rules = HYGIENE_RULE_IDS.filter((rule) => file.rules?.[rule] !== false);
  return {
    config: {
      baselinePath: file.baseline
        ? path.resolve(configDir, file.baseline)
        : path.join(rootDir, DEFAULT_BASELINE_FILE),
      exclude: file.exclude ?? [],
      excludeDirs: [...DEFAULT_EXCLUDED_DIRS, ...(file.excludeDirs ?? [])],
      include: file.include ?? [...DEFAULT_TEST_PATTERNS],
      paths: file.paths ?? ["."],
      rootDir,
      ruleConfig: {
        barrelAliases: file.barrels?.aliases ?? [],
        barrelMockAllowlist: file.barrels?.allowMockIn ?? [],
        barrelPaths: file.barrels?.paths ?? [],
        mockHelperModules: file.mockHelperModules ?? [],
        realExportGetterModules: file.realExportGetters?.modules ?? [],
        realExportGetterNamePattern: file.realExportGetters?.namePattern,
        rootDir,
        sleepCallees: file.sleepCallees ?? [...DEFAULT_SLEEP_CALLEES],
      },
      rules,
    },
  };
};

const TEST_HYGIENE_USAGE = `Usage: terreno-test-hygiene [options] [path ...]

Checks Bun test files for mock-isolation and timing hazards. Paths default to the root.

Options:
  --config <file>         JSON config (default: ./${DEFAULT_CONFIG_FILE} when present).
  --root <dir>            Root that paths, globs, and barrel paths are relative to.
  --include <glob>        Test file glob, root relative (repeatable).
                          Default: ${DEFAULT_TEST_PATTERNS.join(", ")}
  --exclude <glob>        Skip files matching this root-relative glob (repeatable).
  --exclude-dir <name>    Skip directories with this name at any depth (repeatable).
  --baseline <file>       Baseline JSON (default: <root>/${DEFAULT_BASELINE_FILE}).
  --update-baseline       Write current violations to the baseline and exit 0.
  --no-baseline           Ignore any baseline; report every violation.
  --rule <id>             Run only these rules (repeatable).
  --disable-rule <id>     Turn a rule off (repeatable).
  --barrel-alias <glob>   Bare specifier that names a shared barrel, e.g. @hooks (repeatable).
  --barrel-path <glob>    Root-relative module path of a shared barrel, e.g. hooks (repeatable).
  --mock-helper <module>  Module whose named imports register mock.module (repeatable).
  --sleep-callee <name>   Extra sleep callee to flag, e.g. timeout (repeatable).
  --format <text|json>    Output format (default text).
  -h, --help              Show this help.

Rules: ${HYGIENE_RULE_IDS.join(", ")}
Suppress one finding: // ${SUPPRESSION_DIRECTIVE} <rule-id> -- reason

Exit code: 0 when no violations beyond the baseline, 1 otherwise, 2 on usage errors.`;

interface HygieneFlagValues {
  baseline?: string;
  "barrel-alias"?: string[];
  "barrel-path"?: string[];
  config?: string;
  "disable-rule"?: string[];
  exclude?: string[];
  "exclude-dir"?: string[];
  format?: string;
  help?: boolean;
  include?: string[];
  "mock-helper"?: string[];
  "no-baseline"?: boolean;
  root?: string;
  rule?: string[];
  "sleep-callee"?: string[];
  "update-baseline"?: boolean;
}

/** Throws on unknown flags or missing flag values (strict mode). */
const parseHygieneFlags = (args: string[]): {values: HygieneFlagValues; positionals: string[]} =>
  parseArgs({
    allowPositionals: true,
    args,
    options: {
      "barrel-alias": {multiple: true, type: "string"},
      "barrel-path": {multiple: true, type: "string"},
      baseline: {type: "string"},
      config: {type: "string"},
      "disable-rule": {multiple: true, type: "string"},
      exclude: {multiple: true, type: "string"},
      "exclude-dir": {multiple: true, type: "string"},
      format: {type: "string"},
      help: {short: "h", type: "boolean"},
      include: {multiple: true, type: "string"},
      "mock-helper": {multiple: true, type: "string"},
      "no-baseline": {type: "boolean"},
      root: {type: "string"},
      rule: {multiple: true, type: "string"},
      "sleep-callee": {multiple: true, type: "string"},
      "update-baseline": {type: "boolean"},
    },
    strict: true,
  });

export interface TestHygieneCliOptions {
  config: ResolvedHygieneConfig;
  format: "json" | "text";
  isHelp: boolean;
  isUpdateBaseline: boolean;
  useBaseline: boolean;
}

/** Merges the config file (if any) with CLI flags. Flags win; list flags extend the config. */
export const parseTestHygieneArgs = ({
  argv,
  cwd,
  readFile = (filePath: string): string | undefined =>
    existsSync(filePath) ? readFileSync(filePath, "utf-8") : undefined,
}: {
  argv: string[];
  cwd: string;
  readFile?: (filePath: string) => string | undefined;
}): {options: TestHygieneCliOptions} | {error: string} => {
  let parsed: {values: HygieneFlagValues; positionals: string[]};
  try {
    parsed = parseHygieneFlags(argv);
  } catch (error) {
    return {error: (error as Error).message};
  }
  const {values, positionals} = parsed;

  const configPath = path.resolve(cwd, values.config ?? DEFAULT_CONFIG_FILE);
  const configText = readFile(configPath);
  if (values.config && configText === undefined) {
    return {error: `Config file not found: ${configPath}`};
  }
  let file: TestHygieneConfigFile = {};
  if (configText !== undefined) {
    try {
      file = JSON.parse(configText) as TestHygieneConfigFile;
    } catch (error) {
      return {error: `Config ${configPath} is not valid JSON: ${(error as Error).message}`};
    }
  }
  const configDir = configText === undefined ? cwd : path.dirname(configPath);

  const ruleFlags = [...(values.rule ?? []), ...(values["disable-rule"] ?? [])];
  const unknownRule = ruleFlags.find((rule) => !isHygieneRuleId(rule));
  if (unknownRule) {
    return {error: `Unknown rule "${unknownRule}". Rules: ${HYGIENE_RULE_IDS.join(", ")}`};
  }
  const format = values.format ?? "text";
  if (format !== "text" && format !== "json") {
    return {error: `--format must be text or json, got "${format}"`};
  }

  const merged: TestHygieneConfigFile = {
    ...file,
    barrels: {
      ...file.barrels,
      aliases: [...(file.barrels?.aliases ?? []), ...(values["barrel-alias"] ?? [])],
      paths: [...(file.barrels?.paths ?? []), ...(values["barrel-path"] ?? [])],
    },
    exclude: [...(file.exclude ?? []), ...(values.exclude ?? [])],
    excludeDirs: [...(file.excludeDirs ?? []), ...(values["exclude-dir"] ?? [])],
    include: values.include ?? file.include,
    mockHelperModules: [...(file.mockHelperModules ?? []), ...(values["mock-helper"] ?? [])],
    sleepCallees: [
      ...(file.sleepCallees ?? DEFAULT_SLEEP_CALLEES),
      ...(values["sleep-callee"] ?? []),
    ],
  };
  // CLI --root/--baseline/paths are relative to the cwd, not to the config file.
  if (values.root) {
    merged.root = path.resolve(cwd, values.root);
  }
  if (values.baseline) {
    merged.baseline = path.resolve(cwd, values.baseline);
  }
  if (positionals.length > 0) {
    const rootForPaths = path.resolve(configDir, merged.root ?? ".");
    merged.paths = positionals.map((p) => path.relative(rootForPaths, path.resolve(cwd, p)) || ".");
  }

  const {config} = resolveHygieneConfig({configDir, file: merged});
  const onlyRules = values.rule ?? [];
  const disabled = new Set(values["disable-rule"] ?? []);
  config.rules = config.rules.filter(
    (rule) => (onlyRules.length === 0 || onlyRules.includes(rule)) && !disabled.has(rule)
  );

  return {
    options: {
      config,
      format,
      isHelp: values.help ?? false,
      isUpdateBaseline: values["update-baseline"] ?? false,
      useBaseline: !(values["no-baseline"] ?? false),
    },
  };
};

export interface HygieneLogger {
  info: (message: string) => void;
  error: (message: string) => void;
}

const formatCounts = ({counts}: {counts: Record<string, number>}): string =>
  Object.entries(counts)
    .map(([rule, count]) => `  ${rule}: ${count}`)
    .join("\n");

/**
 * CLI entry point: scans test files, applies the baseline, prints findings and per-rule counts,
 * and returns the exit code instead of exiting so it is testable.
 */
export const runTestHygieneCli = ({
  argv,
  cwd = process.cwd(),
  logger = console,
}: {
  argv: string[];
  cwd?: string;
  logger?: HygieneLogger;
}): {exitCode: number} => {
  const parsed = parseTestHygieneArgs({argv, cwd});
  if ("error" in parsed) {
    logger.error(`${parsed.error}\n\n${TEST_HYGIENE_USAGE}`);
    return {exitCode: 2};
  }
  const {options} = parsed;
  if (options.isHelp) {
    logger.info(TEST_HYGIENE_USAGE);
    return {exitCode: 0};
  }
  const {config} = options;

  const {files, missingPaths} = collectFiles({
    cwd: config.rootDir,
    exclude: config.exclude,
    excludeDirs: config.excludeDirs,
    paths: config.paths,
    patterns: config.include,
  });
  if (missingPaths.length > 0) {
    logger.error(`Path(s) do not exist under ${config.rootDir}: ${missingPaths.join(", ")}`);
    return {exitCode: 2};
  }

  const violations = files.flatMap(
    (file) =>
      checkTestSource({
        config: config.ruleConfig,
        fileName: path.join(config.rootDir, file),
        rules: config.rules,
        sourceText: readFileSync(path.join(config.rootDir, file), "utf-8"),
      }).violations
  );

  if (options.isUpdateBaseline) {
    const {entries} = buildBaseline({violations});
    writeFileSync(config.baselinePath, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
    logger.info(
      `Wrote ${config.baselinePath}: ${violations.length} violation(s) across ${entries.length} file/rule pair(s).`
    );
    return {exitCode: 0};
  }

  let baseline: BaselineEntry[] = [];
  if (options.useBaseline && existsSync(config.baselinePath)) {
    const parsedBaseline = parseBaseline({text: readFileSync(config.baselinePath, "utf-8")});
    if ("error" in parsedBaseline) {
      logger.error(`${config.baselinePath}: ${parsedBaseline.error}`);
      return {exitCode: 2};
    }
    baseline = parsedBaseline.entries;
  }
  const {newViolations, staleEntries} = diffAgainstBaseline({baseline, violations});
  const exitCode = newViolations.length === 0 ? 0 : 1;

  if (options.format === "json") {
    logger.info(
      JSON.stringify(
        {
          baselined: violations.length - newViolations.length,
          countsByRule: countByRule({rules: config.rules, violations}).counts,
          filesChecked: files.length,
          newCountsByRule: countByRule({rules: config.rules, violations: newViolations}).counts,
          newViolations,
          staleBaselineEntries: staleEntries,
        },
        null,
        2
      )
    );
    return {exitCode};
  }

  for (const violation of newViolations) {
    logger.error(`${violation.file}:${violation.line} ${violation.ruleId} ${violation.message}`);
  }
  logger.info(
    `\nChecked ${files.length} file(s) under ${config.rootDir}: ${violations.length} violation(s), ` +
      `${violations.length - newViolations.length} baselined, ${newViolations.length} new.`
  );
  logger.info(formatCounts(countByRule({rules: config.rules, violations: newViolations})));
  if (staleEntries.length > 0) {
    logger.info(
      `${staleEntries.length} baseline entr(ies) are higher than current counts; run --update-baseline to ratchet.`
    );
  }
  return {exitCode};
};
