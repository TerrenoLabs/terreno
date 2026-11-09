import {describe, it} from "bun:test";
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {
  collectParityGaps,
  isCovered,
  readMappings,
  readWorkflowPaths,
  samplesForGlob,
  WORKFLOW_PARAMETERS,
} from "./lib";

const createFixtureRepo = ({
  mapping,
  workflowPaths,
}: {
  mapping: string;
  workflowPaths: string[];
}): string => {
  const root = mkdtempSync(join(tmpdir(), "terreno-circleci-parity-"));
  mkdirSync(join(root, ".circleci"), {recursive: true});
  mkdirSync(join(root, ".github", "workflows"), {recursive: true});

  writeFileSync(
    join(root, ".circleci", "config.yml"),
    [
      "version: 2.1",
      "setup: true",
      "workflows:",
      "  setup:",
      "    jobs:",
      "      - path-filtering/filter:",
      "          mapping: |",
      ...mapping.split("\n").map((line) => `            ${line}`),
      "",
    ].join("\n")
  );

  writeFileSync(
    join(root, ".github", "workflows", "api-ci.yml"),
    [
      "name: API CI",
      "on:",
      "  push:",
      "    paths:",
      ...workflowPaths.map((p) => `      - "${p}"`),
      "",
    ].join("\n")
  );

  return root;
};

describe("samplesForGlob", () => {
  it("expands a directory glob to nested sample files", () => {
    assert.deepEqual(samplesForGlob("api/**"), ["api/sample.ts", "api/nested/sample.ts"]);
  });

  it("expands a leading globstar to root and nested variants", () => {
    assert.deepEqual(samplesForGlob("**/package.json"), ["package.json", "nested/package.json"]);
  });

  it("passes an exact path through unchanged", () => {
    assert.deepEqual(samplesForGlob("bun.lock"), ["bun.lock"]);
  });
});

describe("isCovered", () => {
  const mappings = [
    {parameter: "run-api", regex: "api/.*"},
    {parameter: "run-ui", regex: "ui/.*"},
  ];

  it("matches a mapping for the same parameter", () => {
    assert.isTrue(isCovered({mappings, parameter: "run-api", samples: ["api/src/index.ts"]}));
  });

  it("ignores mappings that set a different parameter", () => {
    assert.isFalse(isCovered({mappings, parameter: "run-api", samples: ["ui/src/Box.tsx"]}));
  });

  it("anchors regexes so partial matches do not count", () => {
    assert.isFalse(
      isCovered({
        mappings: [{parameter: "run-api", regex: "api"}],
        parameter: "run-api",
        samples: ["api/src/index.ts"],
      })
    );
  });

  it("requires every glob sample to match, not just one", () => {
    const mappings = [{parameter: "run-repo-policies", regex: "package\\.json"}];
    assert.isFalse(
      isCovered({
        mappings,
        parameter: "run-repo-policies",
        samples: ["package.json", "nested/package.json"],
      })
    );
    assert.isTrue(
      isCovered({
        mappings: [
          {parameter: "run-repo-policies", regex: "package\\.json"},
          {parameter: "run-repo-policies", regex: ".*/package\\.json"},
        ],
        parameter: "run-repo-policies",
        samples: ["package.json", "nested/package.json"],
      })
    );
  });
});

describe("readMappings", () => {
  it("parses whitespace-delimited mapping lines", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true\nui/.* run-ui true",
      workflowPaths: ["api/**"],
    });
    assert.deepEqual(readMappings({repoRoot: root}), [
      {parameter: "run-api", regex: "api/.*"},
      {parameter: "run-ui", regex: "ui/.*"},
    ]);
  });

  it("prefers an enabled config.yml over a parked config.setup.yml", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true",
      workflowPaths: ["api/**"],
    });
    writeFileSync(
      join(root, ".circleci", "config.setup.yml"),
      [
        "version: 2.1",
        "setup: true",
        "workflows:",
        "  setup:",
        "    jobs:",
        "      - path-filtering/filter:",
        "          mapping: |",
        "            ui/.* run-ui true",
        "",
      ].join("\n")
    );
    assert.deepEqual(readMappings({repoRoot: root}), [{parameter: "run-api", regex: "api/.*"}]);
  });

  it("falls back to config.setup.yml when config.yml is a disabled no-op", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true",
      workflowPaths: ["api/**"],
    });
    writeFileSync(
      join(root, ".circleci", "config.setup.yml"),
      [
        "version: 2.1",
        "setup: true",
        "workflows:",
        "  setup:",
        "    jobs:",
        "      - path-filtering/filter:",
        "          mapping: |",
        "            ui/.* run-ui true",
        "",
      ].join("\n")
    );
    writeFileSync(
      join(root, ".circleci", "config.yml"),
      ["version: 2.1", "workflows:", "  disabled:", "    when: false", ""].join("\n")
    );
    assert.deepEqual(readMappings({repoRoot: root}), [{parameter: "run-ui", regex: "ui/.*"}]);
  });
});

describe("readWorkflowPaths", () => {
  it("reads push path filters and de-duplicates them", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true",
      workflowPaths: ["api/**", "api/**", "bun.lock"],
    });
    assert.deepEqual(readWorkflowPaths({repoRoot: root, workflow: "api-ci"}), [
      "api/**",
      "bun.lock",
    ]);
  });
});

describe("collectParityGaps", () => {
  it("reports a GHA path with no mapping for its parameter", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true",
      workflowPaths: ["api/**", "comms/**"],
    });
    assert.deepEqual(
      collectParityGaps({repoRoot: root, workflowParameters: {"api-ci": "run-api"}}),
      [{parameter: "run-api", path: "comms/**", workflow: "api-ci"}]
    );
  });

  it("ignores the workflow's own .github path", () => {
    const root = createFixtureRepo({
      mapping: "api/.* run-api true",
      workflowPaths: ["api/**", ".github/workflows/api-ci.yml"],
    });
    assert.isEmpty(collectParityGaps({repoRoot: root, workflowParameters: {"api-ci": "run-api"}}));
  });

  it("throws when the setup config has no mapping", () => {
    const root = createFixtureRepo({mapping: "", workflowPaths: ["api/**"]});
    assert.throws(
      () => collectParityGaps({repoRoot: root, workflowParameters: {"api-ci": "run-api"}}),
      /no path-filtering mapping/
    );
  });

  it("finds no gaps in the real repository config", () => {
    const repoRoot = join(import.meta.dir, "..", "..");
    assert.isEmpty(collectParityGaps({repoRoot}));
  });

  it("maps Netlify and GCP deploy paths", () => {
    const mappings = readMappings({repoRoot: join(import.meta.dir, "..", "..")});
    const cases: Array<{parameter: string; sample: string}> = [
      {parameter: "run-deploy-demo", sample: "demo/app/_layout.tsx"},
      {parameter: "run-deploy-frontend", sample: "example-frontend/app/index.tsx"},
      {parameter: "run-deploy-docs", sample: "docs/how-to/circleci.md"},
      {parameter: "run-cd-terraform", sample: "terraform/modules/secret/main.tf"},
      {parameter: "run-cd-terraform", sample: "infra/flourish/main.tf"},
      {parameter: "run-cd-backend", sample: "example-backend/src/server.ts"},
      {parameter: "run-cd-backend", sample: "comms/src/commsApp.ts"},
      {parameter: "run-cd-backend", sample: "jobs/src/jobsApp.ts"},
      {parameter: "run-jobs", sample: "jobs/src/jobsService.ts"},
      {parameter: "run-e2e", sample: "jobs/src/jobsApp.ts"},
      {parameter: "run-admin-spa-integration", sample: "jobs/src/routes/jobsAdmin.ts"},
      {parameter: "run-cd-mcp", sample: "mcp-server/src/index.ts"},
    ];
    for (const {parameter, sample} of cases) {
      assert.isTrue(
        isCovered({mappings, parameter, samples: [sample]}),
        `${parameter} should match ${sample}`
      );
    }
  });

  it("covers every ported workflow", () => {
    assert.isAbove(Object.keys(WORKFLOW_PARAMETERS).length, 10);
  });
});
