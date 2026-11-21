import {describe, it} from "bun:test";
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

const repoRoot = join(import.meta.dir, "../..");
const flowsDir = join(repoRoot, ".maestro/flows");
const ciConfigPath = join(repoRoot, ".circleci/continue-config.yml");
const NOT_A_FLOW = new Set(["config.yaml"]);
const LOCAL_ONLY_FLOWS = new Set(["signup.yaml"]);

const topLevelFlows = (): string[] =>
  readdirSync(flowsDir).filter(
    (name) => name.endsWith(".yaml") && !NOT_A_FLOW.has(name) && !LOCAL_ONLY_FLOWS.has(name)
  );

describe("Maestro flow coverage in CircleCI", () => {
  it("runs every top-level flow in a CircleCI Maestro job", () => {
    const config = readFileSync(ciConfigPath, "utf8");
    const missing = topLevelFlows().filter((name) => !config.includes(`.maestro/flows/${name}`));
    assert.deepEqual(missing, []);
  });

  it("runs the demo directory so new demo flows are picked up without editing CI", () => {
    const config = readFileSync(ciConfigPath, "utf8");
    const demoDir = join(flowsDir, "demo");
    assert.isTrue(statSync(demoDir).isDirectory());
    assert.include(config, "maestro test .maestro/flows/demo/");
  });
});
