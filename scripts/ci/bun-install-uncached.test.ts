import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const repoRoot = join(import.meta.dir, "../..");

const read = (relativePath: string): string => {
  return readFileSync(join(repoRoot, relativePath), "utf8");
};

describe("Bun install is uncached", () => {
  it("does not restore ~/.bun/install/cache in the workspace setup action", () => {
    const action = read(".github/actions/setup-bun-workspace/action.yml");
    assert.doesNotMatch(action, /actions\/cache@/);
    assert.doesNotMatch(action, /path:\s*~\/\.bun\/install\/cache/);
    assert.match(action, /bun install --frozen-lockfile/);
  });

  it("does not cache the bun download cache in GitHub workflows", () => {
    const workflowsDir = join(repoRoot, ".github/workflows");
    const leftovers: string[] = [];
    for (const name of readdirSync(workflowsDir)) {
      if (!name.endsWith(".yml")) {
        continue;
      }
      const text = readFileSync(join(workflowsDir, name), "utf8");
      if (text.includes("~/.bun/install/cache")) {
        leftovers.push(name);
      }
    }
    assert.deepEqual(leftovers, []);
  });
});
