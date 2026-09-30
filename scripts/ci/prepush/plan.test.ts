import {describe, expect, it} from "bun:test";
import {dirname, join} from "node:path";

import {readMappings} from "../../check-circleci-parity/lib";
import {affectedParameters, planPrepush, unplannedParameters} from "./plan";
import {parseArguments} from "./run";

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const MAPPINGS = readMappings({repoRoot: REPO_ROOT});
const BASE = "abc123";

const stepNames = (changedFiles: string[]): string[] =>
  planPrepush({baseSha: BASE, changedFiles, mappings: MAPPINGS}).steps.map((step) => step.name);

describe("affectedParameters", () => {
  it("anchors regexes like the path-filtering orb", () => {
    const mappings = [{parameter: "run-api", regex: "api/.*"}];
    expect(affectedParameters({changedFiles: ["api/src/a.ts"], mappings})).toEqual(["run-api"]);
    expect(affectedParameters({changedFiles: ["docs/api/x.md"], mappings})).toEqual([]);
  });
});

describe("planPrepush", () => {
  it("always lints and compiles first", () => {
    expect(stepNames(["README.md"]).slice(0, 2)).toEqual([
      "lint (all packages)",
      "compile (all packages)",
    ]);
  });

  it("runs repo policies when a plugin skill changes (release-announcement regression)", () => {
    const names = stepNames(["plugins/terreno-planning/skills/terreno-2-pick/SKILL.md"]);
    expect(names).toContain("repo-policies: barrels, explicit-any, lifecycle skills, source rules");
    expect(names).toContain("repo-policies: generated skills in sync");
  });

  it("runs example-backend tests when api changes (OpenAPI snapshot regression)", () => {
    const names = stepNames(["api/src/api.ts"]);
    expect(names).toContain("api-ci: test:coverage");
    expect(names).toContain("example-backend-ci: tests");
    expect(names).toContain("docs-deploy: typedoc API reference builds");
  });

  it("runs ui coverage, types, and the LCOV gate for ui source (dashboard regression)", () => {
    const names = stepNames(["ui/src/DashboardGrid.tsx"]);
    expect(names).toContain("ui-ci: types");
    expect(names).toContain("ui-ci: test:coverage");
    expect(names).toContain("ui-ci: new-file LCOV gate");
    expect(names).toContain("new-file-coverage: remaining packages");
  });

  it("skips packages already gated by their own LCOV in the remaining-coverage step", () => {
    const plan = planPrepush({baseSha: BASE, changedFiles: ["ui/src/Box.tsx"], mappings: MAPPINGS});
    const remaining = plan.steps.find(
      (step) => step.name === "new-file-coverage: remaining packages"
    );
    expect(remaining?.command).toContain("--skip-packages=");
    expect(remaining?.command).toContain("ui");
    expect(remaining?.command).toContain(`--base=${BASE}`);
  });

  it("runs the full demo job set for a ui-only change (ui-ci demo parity)", () => {
    const plan = planPrepush({baseSha: BASE, changedFiles: ["ui/src/Box.tsx"], mappings: MAPPINGS});
    const demo = plan.steps.find((step) => step.name.startsWith("ui-demo:"));
    expect(demo?.command).toContain("bun run test:ci");
    expect(demo?.command).toContain("check:demo-coverage");
  });

  it("fingerprints untracked file contents for the rulesync drift check", () => {
    const plan = planPrepush({
      baseSha: BASE,
      changedFiles: [".rulesync/rules/00-root.md"],
      mappings: MAPPINGS,
    });
    const rulesync = plan.steps.find((step) => step.name.startsWith("rulesync-check"));
    expect(rulesync?.command).toContain("git diff HEAD");
    expect(rulesync?.command).toContain("--stdin-paths");
  });

  it("passes the prepush base to the test-isolation check", () => {
    const plan = planPrepush({baseSha: BASE, changedFiles: ["api/src/api.ts"], mappings: MAPPINGS});
    expect(plan.steps.map((step) => step.command)).toContain(
      `bun run check:test-isolation --base ${BASE}`
    );
  });

  it("does not run package tests for a docs-only change", () => {
    const names = stepNames(["docs/how-to/circleci.md"]);
    expect(names.some((name) => name.includes("test:coverage"))).toBe(false);
  });

  it("reports CI-only jobs instead of running them", () => {
    const plan = planPrepush({
      baseSha: BASE,
      changedFiles: ["example-frontend/e2e/login.spec.ts"],
      mappings: MAPPINGS,
    });
    expect(plan.ciOnly.map((item) => item.parameter)).toContain("run-e2e");
  });

  it("plans every parameter with --all", () => {
    const plan = planPrepush({all: true, baseSha: BASE, changedFiles: [], mappings: MAPPINGS});
    expect(plan.parameters).toContain("run-api");
    expect(plan.parameters).toContain("run-cli");
  });
});

describe("unplannedParameters", () => {
  it("covers every parameter the CircleCI mapping can set", () => {
    expect(unplannedParameters({mappings: MAPPINGS})).toEqual([]);
  });
});

describe("parseArguments", () => {
  it("reads flags", () => {
    expect(parseArguments(["--all", "--dry-run", "--base", "origin/main"])).toEqual({
      all: true,
      base: "origin/main",
      isDryRun: true,
    });
  });
});
