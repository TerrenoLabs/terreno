/**
 * Plans the local checks a branch needs before push.
 *
 * The CircleCI path-filter mapping (.circleci/config.yml) decides which CI jobs a
 * change triggers. This module applies the same mapping to the branch's changed
 * files and returns the local commands that mirror each triggered job, so a push
 * that is green locally is green in CI on the first try.
 *
 * Policy: docs/how-to/run-tests-locally.md
 */
import type {Mapping} from "../../check-circleci-parity/lib";

export interface PrepushStep {
  /** Shell command, run from `cwd` (repo root when omitted). */
  command: string;
  cwd?: string;
  /** Human label, usually the CircleCI job the step mirrors. */
  name: string;
}

export interface PrepushPlan {
  /** Parameters CircleCI would set that have no local equivalent. */
  ciOnly: {hint: string; parameter: string}[];
  parameters: string[];
  steps: PrepushStep[];
}

/** Package directories whose CI job runs `test:coverage` then the new-file LCOV gate. */
const COVERAGE_PACKAGES: Record<string, string> = {
  "run-admin-backend": "admin-backend",
  "run-admin-frontend": "admin-frontend",
  "run-admin-spa": "admin-spa",
  "run-ai": "ai",
  "run-api": "api",
  "run-api-health": "api-health",
  "run-comms": "comms",
  "run-create-terreno-app": "create-terreno-app",
  "run-feature-flags": "feature-flags",
  "run-jobs": "jobs",
  "run-mcp-server": "mcp-server",
  "run-rtk": "rtk",
  "run-syncdb": "syncdb",
  "run-test-package": "test",
  "run-ui": "ui",
};

/** Parameters whose CI jobs need infrastructure a laptop run should not assume. */
const CI_ONLY_HINTS: Record<string, string> = {
  "run-admin-spa": "cd admin-spa && bun run test:e2e (Playwright)",
  "run-admin-spa-integration":
    "cd admin-spa && bun run test:integration (needs Mongo + example-backend)",
  "run-circleci-config": "config-only change; CircleCI validates the continuation config",
  "run-docs-site": "cd website && bun run build (Docusaurus; catches broken doc links)",
  "run-e2e":
    "bun run check:e2e-affected, then run the affected shards (docs/how-to/run-tests-locally.md)",
  "run-example-backend-docker": "docker build -f example-backend/Dockerfile .",
  "run-example-backend-script": "cd example-backend && bun run script --list",
  "run-maestro": "bun run maestro:test (needs the Maestro CLI and a running example-frontend)",
  "run-maestro-demo": "bun run demo:maestro:test",
  "run-mcp-server-docker": "docker build -f mcp-server/Dockerfile .",
};

/** Deploy parameters: they ship artifacts rather than verify the change. */
const DEPLOY_PARAMETERS = [
  "run-cd-backend",
  "run-cd-mcp",
  "run-cd-terraform",
  "run-deploy-demo",
  "run-deploy-docs",
  "run-deploy-frontend",
];

/** GitHub Actions-only checks that the CircleCI mapping does not cover. */
const EXTRA_MAPPINGS: Mapping[] = [
  {parameter: "run-cli", regex: "cli/.*"},
  {parameter: "run-docs-api-reference", regex: "(api|rtk)/src/.*"},
  {
    parameter: "run-docs-site",
    regex: "(docs|website)/.*|ui/src/.*|demo/story-config/.*|demo/demoConfig\\.tsx",
  },
  {parameter: "run-mcp-server-docker", regex: "mcp-server/.*"},
];

const repoPolicySteps = ({baseSha}: {baseSha: string}): PrepushStep[] => [
  {
    command: "bun run check",
    name: "repo-policies: barrels, explicit-any, lifecycle skills, source rules",
  },
  {command: "bun test scripts/check-source-rules/", name: "repo-policies: source-rule tests"},
  {
    command: `bun run check:test-isolation --base ${baseSha}`,
    name: "repo-policies: no new mock.module in shared suites",
  },
  {
    command: "bun test scripts/planning/ && bun run test:ci-tools",
    name: "repo-policies: planning + CI tools",
  },
  {command: "bun run skills:check", name: "repo-policies: generated skills in sync"},
  {command: "bun run check:licenses", name: "repo-policies: license coverage"},
  {command: "bun run check:circleci-parity", name: "repo-policies: CircleCI path-filter parity"},
  {
    command: "bun run check:changelog && bun test scripts/changelog/",
    name: "repo-policies: changelog fragments",
  },
  {
    command: "bun test scripts/static-analysis/ && bun run analyze:full",
    name: "repo-policies: static analysis",
  },
];

// Fingerprints staged and unstaged edits plus untracked file contents, so a dirty
// tree still detects any file that `bun run rules` rewrites.
const TREE_FINGERPRINT =
  "( git diff HEAD --no-ext-diff; git ls-files -o --exclude-standard | git hash-object --stdin-paths ) | git hash-object --stdin";
const TREE_HASH_BEFORE = `before=$(${TREE_FINGERPRINT})`;
const TREE_HASH_AFTER = `after=$(${TREE_FINGERPRINT})`;

const regexMatches = ({path, regex}: {path: string; regex: string}): boolean => {
  // The path-filtering orb anchors every regex.
  return new RegExp(`^(?:${regex})$`).test(path);
};

export const affectedParameters = ({
  changedFiles,
  mappings,
}: {
  changedFiles: string[];
  mappings: Mapping[];
}): string[] => {
  const parameters = new Set<string>();
  for (const mapping of mappings) {
    if (changedFiles.some((path) => regexMatches({path, regex: mapping.regex}))) {
      parameters.add(mapping.parameter);
    }
  }
  return [...parameters].sort();
};

const coverageSteps = ({baseSha, pkg}: {baseSha: string; pkg: string}): PrepushStep[] => [
  {command: "bun run test:coverage", cwd: pkg, name: `${pkg}-ci: test:coverage`},
  {
    command: `bun run check:new-file-coverage --base=${baseSha} --threshold=90 --package=${pkg} --lcov=${pkg}/coverage/lcov.info`,
    name: `${pkg}-ci: new-file LCOV gate`,
  },
];

/**
 * Builds the ordered local plan. Lint and compile always run first because every
 * later step depends on compiled workspace packages.
 */
export const planPrepush = ({
  all = false,
  baseSha,
  changedFiles,
  mappings,
}: {
  all?: boolean;
  baseSha: string;
  changedFiles: string[];
  mappings: Mapping[];
}): PrepushPlan => {
  const allMappings = [...mappings, ...EXTRA_MAPPINGS];
  const parameters = all
    ? [...new Set(allMappings.map((mapping) => mapping.parameter))].sort()
    : affectedParameters({changedFiles, mappings: allMappings});
  const has = (parameter: string): boolean => parameters.includes(parameter);

  const steps: PrepushStep[] = [
    {command: "bun run lint", name: "lint (all packages)"},
    {command: "bun run compile", name: "compile (all packages)"},
  ];

  if (has("run-rulesync")) {
    steps.push({
      command: `${TREE_HASH_BEFORE} && bun run rules && ${TREE_HASH_AFTER} && test "$before" = "$after"`,
      name: "rulesync-check: generated agent rules are committed",
    });
  }
  if (has("run-repo-policies")) {
    steps.push(...repoPolicySteps({baseSha}));
  }
  if (has("run-ui")) {
    steps.push({command: "bun run types", cwd: "ui", name: "ui-ci: types"});
  }
  if (has("run-ui") || has("run-ui-demo")) {
    steps.push({
      command:
        "(cd demo && bun run lint && bun run compile && bun run test:ci) && bun test scripts/check-demo-coverage.test.ts && bun run check:demo-coverage",
      name: "ui-demo: lint, typecheck, tests, demo coverage",
    });
  }

  const coveredPackages: string[] = [];
  for (const [parameter, pkg] of Object.entries(COVERAGE_PACKAGES)) {
    if (has(parameter)) {
      coveredPackages.push(pkg);
      steps.push(...coverageSteps({baseSha, pkg}));
    }
  }

  if (has("run-admin-spa")) {
    steps.push({
      command: "bunx tsc --noEmit -p tsconfig.json && bun run build:web && bun run smoke",
      cwd: "admin-spa",
      name: "admin-spa-ci: typecheck, web build, smoke",
    });
  }
  if (has("run-example-backend")) {
    steps.push({
      command: "bun run test",
      cwd: "example-backend",
      name: "example-backend-ci: tests",
    });
  }
  if (has("run-example-frontend")) {
    steps.push({
      command: "bun run test",
      cwd: "example-frontend",
      name: "example-frontend-ci: tests",
    });
  }
  if (has("run-cli")) {
    steps.push({command: "bun run test:ci", cwd: "cli", name: "cli-ci: tests"});
  }
  if (has("run-docs-api-reference")) {
    steps.push({
      command: "bun run generate:api",
      cwd: "website",
      name: "docs-deploy: typedoc API reference builds",
    });
  }
  if (has("run-new-file-coverage")) {
    steps.push({
      command:
        "bun test scripts/check-new-file-coverage.test.ts scripts/check-coverage.test.ts scripts/check-demo-coverage.test.ts scripts/check-package-coverage-ci.test.ts scripts/upload-codecov.test.ts",
      name: "coverage-scripts: gate script tests",
    });
    steps.push({
      command: `bun run check:new-file-coverage --base=${baseSha} --threshold=90 --skip-packages=${coveredPackages.join(",")}`,
      name: "new-file-coverage: remaining packages",
    });
  }

  const ciOnly = parameters
    .filter((parameter) => CI_ONLY_HINTS[parameter])
    .map((parameter) => ({hint: CI_ONLY_HINTS[parameter], parameter}));

  return {ciOnly, parameters, steps};
};

/** Every parameter the mapping can set must be planned locally or declared CI-only. */
export const unplannedParameters = ({mappings}: {mappings: Mapping[]}): string[] => {
  const planned = new Set([
    ...Object.keys(COVERAGE_PACKAGES),
    ...Object.keys(CI_ONLY_HINTS),
    ...DEPLOY_PARAMETERS,
    ...EXTRA_MAPPINGS.map((mapping) => mapping.parameter),
    "run-example-backend",
    "run-example-frontend",
    "run-new-file-coverage",
    "run-repo-policies",
    "run-rulesync",
    "run-ui-demo",
  ]);
  return [...new Set(mappings.map((mapping) => mapping.parameter))]
    .filter((parameter) => !planned.has(parameter))
    .sort();
};
