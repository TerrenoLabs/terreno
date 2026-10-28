import {describe, expect, it} from "bun:test";

import {
  COVERAGE_COMMAND,
  DEDICATED_PACKAGE_CI_JOBS,
  findDedicatedJobsMissingCoverage,
  findGhaCodecovUploadsMissingToken,
  findGhaLcovStepsMissingRepoRootCwd,
  findMatrixPackagesMissingCoverage,
  jobCommandBlock,
  MATRIX_PACKAGES,
  NEW_FILE_LCOV_CIRCLE_COMMAND,
  NEW_FILE_LCOV_SCRIPT,
  parseCircleMatrixPackages,
  parseGhaMatrixPackages,
  runPackageCoverageCiCheck,
  runPackagesCiMatrixCheck,
  sourceRunsCoverage,
} from "./check-package-coverage-ci";

describe("jobCommandBlock", () => {
  it("returns the named job until the next top-level job", () => {
    const source = [
      "jobs:",
      "  ui-ci:",
      "    steps:",
      "      - run: bun test",
      "  ai-ci:",
      "    steps:",
      "",
    ].join("\n");
    expect(jobCommandBlock(source, "ui-ci")).toContain("bun test");
    expect(jobCommandBlock(source, "ui-ci")).not.toContain("ai-ci:");
  });
});

describe("sourceRunsCoverage", () => {
  it("detects the coverage script command", () => {
    expect(sourceRunsCoverage(`bun run lint\n${COVERAGE_COMMAND}\n`)).toBe(true);
    expect(sourceRunsCoverage("bun run test:ci")).toBe(false);
  });
});

describe("findDedicatedJobsMissingCoverage", () => {
  it("names jobs that still run bun test instead of test:coverage", () => {
    const continueConfig = [
      "jobs:",
      "  api-ci:",
      `    command: ${COVERAGE_COMMAND} ${NEW_FILE_LCOV_CIRCLE_COMMAND}`,
      "  ai-ci:",
      "    command: bun run test",
      "  blocks-ci:",
      `    command: ${COVERAGE_COMMAND} ${NEW_FILE_LCOV_CIRCLE_COMMAND}`,
      "  rtk-ci:",
      `    command: ${COVERAGE_COMMAND} ${NEW_FILE_LCOV_CIRCLE_COMMAND}`,
      "  ui-ci:",
      "    command: bun run test:ci",
      "  syncdb-ci:",
      "    command: bun run test",
      "  comms-ci:",
      "    command: bun run test",
      "  mcp-server-ci:",
      `    command: ${COVERAGE_COMMAND} ${NEW_FILE_LCOV_CIRCLE_COMMAND}`,
      "  admin-spa-ci:",
      "    command: bun run test:ci",
      "",
    ].join("\n");
    const ghaSources: Record<string, string> = {};
    for (const {ghaWorkflow} of DEDICATED_PACKAGE_CI_JOBS) {
      ghaSources[ghaWorkflow] = `${COVERAGE_COMMAND}\n${NEW_FILE_LCOV_SCRIPT}`;
    }
    expect(findDedicatedJobsMissingCoverage({continueConfig, ghaSources})).toEqual([
      "circleci:admin-spa-ci",
      "circleci:ai-ci",
      "circleci:comms-ci",
      "circleci:syncdb-ci",
      "circleci:ui-ci",
    ]);
  });
});

describe("findGhaLcovStepsMissingRepoRootCwd", () => {
  it("flags Gate new files steps that inherit a package working-directory", () => {
    const source = [
      "defaults:",
      "  run:",
      "    working-directory: api",
      "jobs:",
      "  test:",
      "    steps:",
      "      - name: Gate new files from LCOV",
      "        run: bash scripts/ci/check-new-file-coverage-lcov.sh api",
      "",
    ].join("\n");
    expect(findGhaLcovStepsMissingRepoRootCwd({"api-ci.yml": source})).toEqual([
      "gha:api-ci.yml:lcov-cwd",
    ]);
  });

  it("accepts an explicit repo-root working-directory on the LCOV step", () => {
    const source = [
      "      - name: Gate new files from LCOV",
      "        working-directory: .",
      `        run: bash ${NEW_FILE_LCOV_SCRIPT} api`,
      "",
    ].join("\n");
    expect(findGhaLcovStepsMissingRepoRootCwd({"api-ci.yml": source})).toEqual([]);
  });
});

describe("findGhaCodecovUploadsMissingToken", () => {
  it("flags upload-codecov steps without CODECOV_TOKEN", () => {
    const source = [
      "      - name: Upload coverage to Codecov",
      "        uses: ./.github/actions/upload-codecov",
      "        with:",
      "          directory: api",
      "          flag: api",
      "",
    ].join("\n");
    expect(findGhaCodecovUploadsMissingToken({"api-ci.yml": source})).toEqual([
      "gha:api-ci.yml:codecov-token",
    ]);
    const withToken = [
      "      - name: Upload coverage to Codecov",
      "        uses: ./.github/actions/upload-codecov",
      "        with:",
      "          directory: api",
      "          flag: api",
      "          token: ${{" + " secrets.CODECOV_TOKEN }}",
      "",
    ].join("\n");
    expect(findGhaCodecovUploadsMissingToken({"api-ci.yml": withToken})).toEqual([]);
  });
});

describe("runPackageCoverageCiCheck", () => {
  it("passes when every dedicated package CI job runs test:coverage", () => {
    expect(runPackageCoverageCiCheck().ok).toBe(true);
  });
});

describe("parseGhaMatrixPackages", () => {
  it("reads matrix.include package names", () => {
    const source = [
      "jobs:",
      "  packages:",
      "    strategy:",
      "      matrix:",
      "        include:",
      "          - package: test",
      "          - package: admin-backend",
      "",
    ].join("\n");
    expect(parseGhaMatrixPackages(source)).toEqual(["admin-backend", "test"]);
  });
});

describe("parseCircleMatrixPackages", () => {
  it("reads packages-ci workflow invocations", () => {
    const source = [
      "workflows:",
      "  admin-backend:",
      "    jobs:",
      "      - packages-ci:",
      "          package: admin-backend",
      "          compile-deps: api",
      "  test:",
      "    jobs:",
      "      - packages-ci:",
      "          package: test",
      "",
    ].join("\n");
    expect(parseCircleMatrixPackages(source)).toEqual(["admin-backend", "test"]);
  });
});

describe("findMatrixPackagesMissingCoverage", () => {
  it("requires GHA on:[], commands, matrix, CircleCI job, invocations, params, mappings", () => {
    const missing = findMatrixPackagesMissingCoverage({
      continueConfig: "jobs:\n  ui-ci:\n    command: bun test\n",
      ghaSource: "name: Packages CI\non: push\njobs: {}\n",
      setupConfig: "mapping: |\n            ui/.* run-ui true\n",
    });
    expect(missing.length).toBeGreaterThan(0);
    expect(missing).toContain("gha:packages-ci.yml:on");
  });
});

describe("runPackagesCiMatrixCheck", () => {
  it("passes when the packages-ci matrix covers unpublished-workflow packages", () => {
    expect(runPackagesCiMatrixCheck().ok).toBe(true);
  });

  it("lists the expected matrix packages", () => {
    expect([...MATRIX_PACKAGES]).toEqual([
      "admin-backend",
      "admin-frontend",
      "api-health",
      "feature-flags",
      "test",
    ]);
  });
});
