#!/usr/bin/env bun
/**
 * Fails when published-package CI does not run `bun run test:coverage`.
 *
 * Dedicated jobs and the packages-ci matrix are both required. CircleCI is the
 * live gate; retained GHA workflows must match.
 */
import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";

export const DEDICATED_PACKAGE_CI_JOBS: {circleJob: string; ghaWorkflow: string}[] = [
  {circleJob: "api-ci", ghaWorkflow: "api-ci.yml"},
  {circleJob: "ai-ci", ghaWorkflow: "ai-ci.yml"},
  {circleJob: "blocks-ci", ghaWorkflow: "blocks-ci.yml"},
  {circleJob: "rtk-ci", ghaWorkflow: "rtk-ci.yml"},
  {circleJob: "ui-ci", ghaWorkflow: "ui-ci.yml"},
  {circleJob: "syncdb-ci", ghaWorkflow: "syncdb-ci.yml"},
  {circleJob: "comms-ci", ghaWorkflow: "comms-ci.yml"},
  {circleJob: "mcp-server-ci", ghaWorkflow: "mcp-server-ci.yml"},
  {circleJob: "admin-spa-ci", ghaWorkflow: "admin-spa-ci.yml"},
];

export const COVERAGE_COMMAND = "bun run test:coverage";
export const NEW_FILE_LCOV_SCRIPT = "scripts/ci/check-new-file-coverage-lcov.sh";
export const NEW_FILE_LCOV_CIRCLE_COMMAND = "check_new_file_lcov";

/** Published packages with no dedicated *-ci workflow; covered by packages-ci. */
export const MATRIX_PACKAGES = [
  "admin-backend",
  "admin-frontend",
  "api-health",
  "feature-flags",
  "test",
] as const;

export const MATRIX_PARAMETERS: Record<(typeof MATRIX_PACKAGES)[number], string> = {
  "admin-backend": "run-admin-backend",
  "admin-frontend": "run-admin-frontend",
  "api-health": "run-api-health",
  "feature-flags": "run-feature-flags",
  test: "run-test-package",
};

const repoRootFromMeta = (): string => join(dirname(new URL(import.meta.url).pathname), "..");

export const jobCommandBlock = (source: string, jobName: string): string | null => {
  const marker = `\n  ${jobName}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return null;
  }
  const rest = source.slice(start + 1);
  const nextJob = rest.search(/\n {2}[a-z0-9-]+:\n/);
  if (nextJob < 0) {
    return rest;
  }
  return rest.slice(0, nextJob);
};

export const sourceRunsCoverage = (source: string): boolean => {
  return source.includes(COVERAGE_COMMAND);
};

const GHA_CODECOV_TOKEN_INPUT = "token: ${{" + " secrets.CODECOV_TOKEN }}";

const nextGhaStepBlock = (source: string): string => {
  const next = source.search(/\n {6}- /);
  if (next < 0) {
    return source;
  }
  return source.slice(0, next);
};

/** LCOV gate is repo-root-relative; package `defaults.run.working-directory` must not apply. */
export const findGhaLcovStepsMissingRepoRootCwd = (
  ghaSources: Record<string, string>
): string[] => {
  const missing: string[] = [];
  for (const [file, source] of Object.entries(ghaSources)) {
    if (!source.includes(NEW_FILE_LCOV_SCRIPT)) {
      continue;
    }
    const parts = source.split("- name: Gate new files from LCOV");
    for (let i = 1; i < parts.length; i++) {
      const block = nextGhaStepBlock(parts[i]);
      if (!block.includes("working-directory: .")) {
        missing.push(`gha:${file}:lcov-cwd`);
      }
    }
  }
  return missing.sort();
};

export const findGhaCodecovUploadsMissingToken = (ghaSources: Record<string, string>): string[] => {
  const missing: string[] = [];
  for (const [file, source] of Object.entries(ghaSources)) {
    if (!source.includes("uses: ./.github/actions/upload-codecov")) {
      continue;
    }
    const parts = source.split("uses: ./.github/actions/upload-codecov");
    for (let i = 1; i < parts.length; i++) {
      const block = nextGhaStepBlock(parts[i]);
      if (!block.includes(GHA_CODECOV_TOKEN_INPUT)) {
        missing.push(`gha:${file}:codecov-token`);
      }
    }
  }
  return missing.sort();
};

export const findDedicatedJobsMissingCoverage = ({
  continueConfig,
  ghaSources,
}: {
  continueConfig: string;
  ghaSources: Record<string, string>;
}): string[] => {
  const missing: string[] = [];
  for (const {circleJob, ghaWorkflow} of DEDICATED_PACKAGE_CI_JOBS) {
    const circleBlock = jobCommandBlock(continueConfig, circleJob);
    if (
      !circleBlock ||
      !sourceRunsCoverage(circleBlock) ||
      !circleBlock.includes(NEW_FILE_LCOV_CIRCLE_COMMAND)
    ) {
      missing.push(`circleci:${circleJob}`);
    }
    const gha = ghaSources[ghaWorkflow] ?? "";
    if (!sourceRunsCoverage(gha) || !gha.includes(NEW_FILE_LCOV_SCRIPT)) {
      missing.push(`gha:${ghaWorkflow}`);
    }
  }
  missing.push(...findGhaLcovStepsMissingRepoRootCwd(ghaSources));
  missing.push(...findGhaCodecovUploadsMissingToken(ghaSources));
  return missing.sort();
};

export const runPackageCoverageCiCheck = (
  repoRoot: string = repoRootFromMeta()
): {missing: string[]; ok: boolean} => {
  const continueConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");
  const ghaSources: Record<string, string> = {};
  for (const {ghaWorkflow} of DEDICATED_PACKAGE_CI_JOBS) {
    ghaSources[ghaWorkflow] = readFileSync(
      join(repoRoot, ".github/workflows", ghaWorkflow),
      "utf8"
    );
  }
  const missing = findDedicatedJobsMissingCoverage({continueConfig, ghaSources});
  return {missing, ok: missing.length === 0};
};

export const parseGhaMatrixPackages = (source: string): string[] => {
  const doc = Bun.YAML.parse(source) as {
    jobs?: Record<
      string,
      {strategy?: {matrix?: {include?: Array<{package?: string}>; package?: string[]}}}
    >;
  };
  const packages = new Set<string>();
  for (const job of Object.values(doc.jobs ?? {})) {
    const matrix = job.strategy?.matrix;
    for (const row of matrix?.include ?? []) {
      if (row.package) {
        packages.add(row.package);
      }
    }
    for (const name of matrix?.package ?? []) {
      packages.add(name);
    }
  }
  return [...packages].sort();
};

export const parseCircleMatrixPackages = (continueConfig: string): string[] => {
  const packages = new Set<string>();
  const invocation =
    /packages-ci:\n(?:[ \t]+[a-z0-9-]+:[^\n]*\n)*[ \t]+package:[ \t]+([a-z0-9-]+)/g;
  for (const match of continueConfig.matchAll(invocation)) {
    packages.add(match[1]);
  }
  return [...packages].sort();
};

export const findMatrixPackagesMissingCoverage = ({
  continueConfig,
  ghaSource,
  setupConfig,
}: {
  continueConfig: string;
  ghaSource: string;
  setupConfig: string;
}): string[] => {
  const missing: string[] = [];
  if (!ghaSource.includes("branches-ignore:") || !ghaSource.includes('- "**"')) {
    missing.push("gha:packages-ci.yml:on");
  }
  if (
    !sourceRunsCoverage(ghaSource) ||
    !ghaSource.includes("bun run lint") ||
    !ghaSource.includes("bun run compile") ||
    !ghaSource.includes(NEW_FILE_LCOV_SCRIPT)
  ) {
    missing.push("gha:packages-ci.yml:commands");
  }
  missing.push(...findGhaLcovStepsMissingRepoRootCwd({"packages-ci.yml": ghaSource}));
  missing.push(...findGhaCodecovUploadsMissingToken({"packages-ci.yml": ghaSource}));
  const ghaPackages = parseGhaMatrixPackages(ghaSource);
  if (ghaPackages.join(",") !== [...MATRIX_PACKAGES].join(",")) {
    missing.push(`gha:packages-ci.yml:matrix:${ghaPackages.join("|") || "empty"}`);
  }

  const circleJob = jobCommandBlock(continueConfig, "packages-ci");
  if (
    !circleJob ||
    !sourceRunsCoverage(circleJob) ||
    !circleJob.includes("bun run lint") ||
    !circleJob.includes("bun run compile") ||
    !circleJob.includes(NEW_FILE_LCOV_CIRCLE_COMMAND)
  ) {
    missing.push("circleci:packages-ci");
  }
  const circlePackages = parseCircleMatrixPackages(continueConfig);
  if (circlePackages.join(",") !== [...MATRIX_PACKAGES].join(",")) {
    missing.push(`circleci:packages-ci:invocations:${circlePackages.join("|") || "empty"}`);
  }

  for (const pkg of MATRIX_PACKAGES) {
    const parameter = MATRIX_PARAMETERS[pkg];
    if (!continueConfig.includes(`${parameter}:`)) {
      missing.push(`circleci:parameter:${parameter}`);
    }
    if (!setupConfig.includes(`${pkg}/.* ${parameter} true`)) {
      missing.push(`circleci:mapping:${parameter}`);
    }
  }
  return missing.sort();
};

export const runPackagesCiMatrixCheck = (
  repoRoot: string = repoRootFromMeta()
): {missing: string[]; ok: boolean} => {
  const continueConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");
  const setupConfig = readFileSync(join(repoRoot, ".circleci/config.yml"), "utf8");
  let ghaSource = "";
  try {
    ghaSource = readFileSync(join(repoRoot, ".github/workflows/packages-ci.yml"), "utf8");
  } catch {
    return {missing: ["gha:packages-ci.yml"], ok: false};
  }
  const missing = findMatrixPackagesMissingCoverage({continueConfig, ghaSource, setupConfig});
  return {missing, ok: missing.length === 0};
};

const main = (): void => {
  const dedicated = runPackageCoverageCiCheck();
  const matrix = runPackagesCiMatrixCheck();
  const missing = [...dedicated.missing, ...matrix.missing];
  if (missing.length > 0) {
    console.error("check-package-coverage-ci: missing coverage CI:");
    for (const name of missing) {
      console.error(`  ${name}`);
    }
    process.exit(1);
  }
  console.info(
    "check-package-coverage-ci: dedicated jobs and packages-ci matrix run test:coverage"
  );
};

if (import.meta.main) {
  main();
}
