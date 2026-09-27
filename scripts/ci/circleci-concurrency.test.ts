import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {readMappings} from "../check-circleci-parity/lib";
import {PACKAGE_CI_LCOV_SKIP} from "../check-new-file-coverage";
import {jobCommandBlock} from "../check-package-coverage-ci";

const repoRoot = join(import.meta.dir, "../..");
const continueConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");
const setupConfig = readFileSync(join(repoRoot, ".circleci/config.yml"), "utf8");

const E2E_SHARDS: Record<string, string[]> = {
  "admin-core": [
    "admin",
    "admin-home",
    "admin-form",
    "admin-todo-crud",
    "admin-title-update-depth",
  ],
  "admin-table": [
    "admin-table-search-filter",
    "admin-table-bulk-actions",
    "admin-custom-screens",
    "admin-comms-back",
  ],
  app: ["todos", "profile", "realtime", "ai-chat", "pdf", "notifications"],
  auth: ["login", "signup", "consents", "forgot-password", "reset-password", "verify-email"],
  syncdb: [
    "syncdb-load-delta",
    "syncdb-offline",
    "syncdb-conflicts",
    "syncdb-storage",
    "syncdb-chaos",
  ],
};

const workflowKeys = (source: string): string[] => {
  const start = source.indexOf("\nworkflows:\n");
  assert.ok(start >= 0);
  const body = source.slice(start);
  return [...body.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((match) => match[1]);
};

const mappingMatches = ({
  mappings,
  parameter,
  path,
}: {
  mappings: ReturnType<typeof readMappings>;
  parameter: string;
  path: string;
}): boolean => {
  return mappings
    .filter((mapping) => mapping.parameter === parameter)
    .some((mapping) => new RegExp(`^(?:${mapping.regex})$`).test(path));
};

describe("CircleCI concurrency", () => {
  it("does not declare duplicate workflow keys (YAML last-key-wins)", () => {
    const keys = workflowKeys(continueConfig);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const key of keys) {
      if (seen.has(key)) {
        duplicates.push(key);
      }
      seen.add(key);
    }
    assert.deepEqual(duplicates, []);
  });

  it("installs bun packages without a CircleCI dependency cache", () => {
    const start = continueConfig.indexOf("  install_bun_and_deps:\n");
    assert.ok(start >= 0);
    const next = continueConfig.indexOf("\n  resolve_preview_pr_number:", start);
    const slice = continueConfig.slice(start, next > start ? next : undefined);
    assert.match(slice, /pkg-manager: bun/);
    assert.match(slice, /with-cache: false/);
    assert.doesNotMatch(continueConfig, /include-branch-in-cache-key/);
    assert.doesNotMatch(continueConfig, /cache-version: v1/);
  });

  it("runs repository policies as a single job", () => {
    const repoPolicies = jobCommandBlock(continueConfig, "repo-policies");
    assert.ok(repoPolicies);
    assert.match(repoPolicies, /bun run check:no-barrel-imports/);
    assert.match(repoPolicies, /bun run check:dependency-cruiser/);
    assert.doesNotMatch(repoPolicies, /knip/);
    assert.doesNotMatch(continueConfig, /\n {6}- no-barrel-imports\n/);
    assert.doesNotMatch(continueConfig, /\n {6}- changelog-fragments\n/);
  });

  it("groups Playwright into five shards that cover every PR spec", () => {
    const e2eJob = jobCommandBlock(continueConfig, "e2e");
    assert.ok(e2eJob);
    assert.match(e2eJob, /parameters:\n {6}shard:/);
    assert.match(
      continueConfig,
      /shard:\n {16}- auth\n {16}- app\n {16}- admin-core\n {16}- admin-table\n {16}- syncdb\n/
    );

    const listed = new Set<string>();
    for (const [shard, specs] of Object.entries(E2E_SHARDS)) {
      assert.match(continueConfig, new RegExp(`${shard}\\) specs="[^"]+"`));
      for (const spec of specs) {
        listed.add(spec);
        assert.match(continueConfig, new RegExp(`${shard}\\) specs="[^"]*\\b${spec}\\b`));
      }
    }

    const specFiles = readdirSync(join(repoRoot, "example-frontend/e2e")).filter((name) =>
      name.endsWith(".spec.ts")
    );
    const prSpecs = specFiles
      .map((name) => name.replace(/\.spec\.ts$/, ""))
      .filter((name) => name !== "syncdb-loadlab");
    assert.deepEqual([...listed].sort(), [...prSpecs].sort());
  });

  it("does not start example-backend CI for ui or rtk-only changes", () => {
    const mappings = readMappings({repoRoot});
    assert.equal(
      mappingMatches({mappings, parameter: "run-example-backend", path: "ui/src/Box.tsx"}),
      false
    );
    assert.equal(
      mappingMatches({mappings, parameter: "run-example-backend", path: "rtk/src/index.ts"}),
      false
    );
    assert.equal(
      mappingMatches({
        mappings,
        parameter: "run-example-backend",
        path: "example-backend/src/index.ts",
      }),
      true
    );
  });

  it("does not start new-file-coverage for Playwright specs or generic ts files", () => {
    const mappings = readMappings({repoRoot});
    assert.equal(
      mappingMatches({
        mappings,
        parameter: "run-new-file-coverage",
        path: "example-frontend/e2e/login.spec.ts",
      }),
      false
    );
    assert.equal(
      mappingMatches({mappings, parameter: "run-new-file-coverage", path: "docs/how-to/foo.ts"}),
      false
    );
    assert.equal(
      mappingMatches({mappings, parameter: "run-new-file-coverage", path: "api/src/api.ts"}),
      true
    );
    assert.equal(
      mappingMatches({mappings, parameter: "run-new-file-coverage", path: "jobs/src/index.ts"}),
      true
    );
    assert.doesNotMatch(setupConfig, /\.\*\\\.ts\$ run-new-file-coverage true/);
  });

  it("skips architectural review before checkout when secrets are missing", () => {
    const block = jobCommandBlock(continueConfig, "architectural-pr-review");
    assert.ok(block);
    const skipAt = block.indexOf("Skip when review secrets are missing");
    const checkoutAt = block.indexOf("- checkout");
    assert.notEqual(skipAt, -1);
    assert.notEqual(checkoutAt, -1);
    assert.ok(skipAt < checkoutAt);
  });

  it("folds demo typecheck and admin scripts into the jobs that already install deps", () => {
    const uiCi = jobCommandBlock(continueConfig, "ui-ci");
    assert.ok(uiCi);
    assert.match(uiCi, /demo_lint_and_typecheck/);
    const backend = jobCommandBlock(continueConfig, "example-backend-ci");
    assert.ok(backend);
    assert.match(backend, /bun run script --list/);
    assert.match(continueConfig, /equal: \[false, << pipeline.parameters.run-example-backend >>\]/);
  });

  it("runs Knip in its own always-on job on Node 22.14 so it can load oxc-parser", () => {
    assert.match(continueConfig, /node22_knip:\n {4}docker:\n {6}- image: cimg\/node:22\.14/);
    assert.match(continueConfig, /\n {2}knip:\n {4}executor: node22_knip/);
    const knip = jobCommandBlock(continueConfig, "knip");
    assert.ok(knip);
    assert.match(knip, /bun run check:knip/);
    assert.match(continueConfig, /always:\n {4}jobs:\n {6}- knip\n/);
  });

  it("does not duplicate repo-policies on config-only kitchen-sink", () => {
    const start = continueConfig.indexOf("  circleci-config:\n");
    assert.ok(start >= 0);
    const next = continueConfig.indexOf("\n  deploy-demo-production:\n", start);
    const slice = continueConfig.slice(start, next > start ? next : undefined);
    assert.doesNotMatch(slice, /\n {6}- repo-policies\n/);
    assert.match(slice, /shard:\n {16}- auth\n/);
  });

  it("starts coverage and Maestro for example-frontend components", () => {
    const mappings = readMappings({repoRoot});
    const component = "example-frontend/components/SyncTodosScreen.tsx";
    assert.equal(
      mappingMatches({mappings, parameter: "run-new-file-coverage", path: component}),
      true
    );
    assert.equal(mappingMatches({mappings, parameter: "run-maestro", path: component}), true);
    assert.equal(mappingMatches({mappings, parameter: "run-e2e", path: component}), true);
  });

  it("reuses package-CI LCOV and splits coverage script tests", () => {
    const coverage = jobCommandBlock(continueConfig, "new-file-coverage");
    assert.ok(coverage);
    assert.doesNotMatch(coverage, /bun run --filter '@terreno\/api' compile/);
    assert.match(coverage, /--skip-packages=/);
    const scripts = jobCommandBlock(continueConfig, "coverage-scripts");
    assert.ok(scripts);
    assert.match(scripts, /scripts\/check-new-file-coverage.test.ts/);
    const apiCi = jobCommandBlock(continueConfig, "api-ci");
    assert.ok(apiCi);
    assert.match(apiCi, /check_new_file_lcov/);
    for (const {packageName, pipelineParameter} of PACKAGE_CI_LCOV_SKIP) {
      assert.match(
        coverage,
        new RegExp(`add_skip "<< pipeline.parameters.${pipelineParameter} >>" ${packageName}`)
      );
    }
  });
});

describe("CircleCI config parameter syntax", () => {
  it("has no unescaped << outside pipeline/parameters references", () => {
    // CircleCI 2.1 treats every `<<` as a parameter tag; a shell here-string fails compile
    // for every continuation pipeline, not just the job that uses it.
    for (const [name, config] of [
      ["config.yml", setupConfig],
      ["continue-config.yml", continueConfig],
    ]) {
      const stray = config
        .split("\n")
        .map((line, index) => ({line, number: index + 1}))
        .filter(({line}) =>
          /(^|[^\\])<</.test(line.replace(/<< *(pipeline|parameters)\.[^>]*>>/g, ""))
        );
      assert.deepEqual(stray, [], `${name} has unescaped <<`);
    }
  });
});
