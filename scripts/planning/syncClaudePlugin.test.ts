import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";
import {
  buildClaudePluginFiles,
  rewriteStageNames,
  shortenStageName,
  syncClaudePlugin,
} from "./syncClaudePlugin.ts";

const ROOT_DIRECTORY = resolve(import.meta.dir, "../..");

describe("Claude plugin sync", (): void => {
  it("shortens canonical stage names", (): void => {
    assert.equal(shortenStageName("terreno-1-grow"), "1-grow");
    assert.equal(shortenStageName("terreno-5-taste"), "5-taste");
    assert.equal(shortenStageName("terreno-pick-roast-loop"), "pick-roast-loop");
    assert.equal(shortenStageName("terreno-prd"), "prd");
  });

  it("rewrites stage frontmatter without touching the plugin directory name", (): void => {
    assert.equal(
      rewriteStageNames("name: terreno-1-grow\nSee plugins/terreno-planning/references/x.md"),
      "name: 1-grow\nSee plugins/terreno-planning/references/x.md"
    );
  });

  it("keeps the committed Claude plugin tree in sync", (): void => {
    assert.deepEqual(syncClaudePlugin({check: true, rootDirectory: ROOT_DIRECTORY}), []);
  });

  it("emits shortened skills, shared references, and a terreno manifest", (): void => {
    const files = buildClaudePluginFiles({rootDirectory: ROOT_DIRECTORY});
    const paths = files.map(({path}) => path);

    assert.include(paths, "skills/1-grow/SKILL.md");
    assert.include(paths, "skills/2-pick/SKILL.md");
    assert.include(paths, "skills/3-roast/SKILL.md");
    assert.include(paths, "skills/5-taste/SKILL.md");
    assert.include(paths, "skills/pick-roast-loop/SKILL.md");
    assert.include(paths, "skills/prd/SKILL.md");
    assert.include(paths, "skills/planning-loop/SKILL.md");
    assert.include(paths, "skills/taste-sweep/SKILL.md");
    assert.include(paths, "skills/terreno-backend-api/SKILL.md");
    assert.include(paths, "skills/terreno-ui/SKILL.md");
    assert.include(paths, "skills/verify-ui-changes/SKILL.md");
    assert.include(paths, "agents/pre-commit.md");
    assert.include(paths, "agents/ui-verifier.md");
    assert.include(paths, "references/lifecycle-contract.md");
    assert.include(paths, "references/pick-roast-loop.md");
    assert.notInclude(paths, "skills/terreno-1-grow/SKILL.md");
    assert.notInclude(paths, "skills/terreno-planning-loop/SKILL.md");
    assert.notInclude(paths, "skills/terreno-taste-sweep/SKILL.md");

    const grow = files.find(({path}) => path === "skills/1-grow/SKILL.md");
    assert.include(grow?.contents ?? "", "name: 1-grow");
    assert.include(grow?.contents ?? "", "../../references/lifecycle-contract.md");

    const pick = files.find(({path}) => path === "skills/2-pick/SKILL.md");
    const roast = files.find(({path}) => path === "skills/3-roast/SKILL.md");
    assert.include(pick?.contents ?? "", "name: 2-pick");
    assert.include(pick?.contents ?? "", "../../references/pick-roast-loop.md");
    assert.include(pick?.contents ?? "", "Roast never invokes Pick");
    assert.include(pick?.contents ?? "", "repeat from Reconstruct");
    assert.include(roast?.contents ?? "", "name: 3-roast");
    assert.include(roast?.contents ?? "", "Pick owns the inner loop");
    assert.include(roast?.contents ?? "", "Roast never invokes Pick");

    const continuousLoop = files.find(({path}) => path === "skills/pick-roast-loop/SKILL.md");
    assert.include(continuousLoop?.contents ?? "", "name: pick-roast-loop");
    assert.include(continuousLoop?.contents ?? "", "genuine human decision");

    const manifest = JSON.parse(
      files.find(({path}) => path === ".claude-plugin/plugin.json")?.contents ?? "{}"
    ) as {agents: string[]; name: string; skills: string; version: string};
    const cursorManifest = JSON.parse(
      readFileSync(
        resolve(ROOT_DIRECTORY, "plugins/terreno-planning/.cursor-plugin/plugin.json"),
        "utf8"
      )
    ) as {version: string};

    assert.equal(manifest.name, "terreno");
    assert.equal(manifest.skills, "./skills/");
    assert.deepEqual(manifest.agents, ["./agents/pre-commit.md", "./agents/ui-verifier.md"]);
    assert.equal(manifest.version, cursorManifest.version);
  });
});
