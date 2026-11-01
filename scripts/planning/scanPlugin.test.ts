import {describe, it} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {join, resolve} from "node:path";
import {assert} from "chai";
import {buildClaudePluginFiles, CLAUDE_PLUGIN_TARGETS} from "./syncClaudePlugin.ts";

const ROOT_DIRECTORY = resolve(import.meta.dir, "../..");
const CANONICAL_DIRECTORY = join(ROOT_DIRECTORY, "plugins/terreno-loop");

const SCAN_STAGES = [
  {directory: "terreno-loop-1-aim", next: ["next: sweep", "next: aim", "next: null"]},
  {directory: "terreno-loop-2-sweep", next: ["next: sift", "next: sweep"]},
  {directory: "terreno-loop-3-sift", next: ["next: plot", "next: track", "next: sift"]},
  {directory: "terreno-loop-4-plot", next: ["next: track", "next: plot"]},
  {directory: "terreno-loop-5-track", next: ["next: plot", "next: sweep", "next: null"]},
];

const STAGE_SECTIONS = [
  "## Preconditions",
  "## Inputs",
  "## Procedure",
  "## Supporting skills",
  "## Evidence produced",
  "## Success conditions",
  "## Failure conditions",
  "## Blocked conditions",
  "## Recommended next stage",
];

const readSkill = (directory: string): string =>
  readFileSync(join(CANONICAL_DIRECTORY, "skills", directory, "SKILL.md"), "utf8");

const [, SCAN_TARGET] = CLAUDE_PLUGIN_TARGETS;

describe("scan plugin", (): void => {
  it("ships every stage with the shared stage anatomy", (): void => {
    for (const {directory, next} of SCAN_STAGES) {
      const content = readSkill(directory);
      assert.include(content, `name: ${directory}`, `${directory} frontmatter name`);
      assert.notInclude(
        content,
        "disable-model-invocation: true",
        `${directory} must stay model-invocable`
      );
      for (const section of STAGE_SECTIONS) {
        assert.include(content, section, `${directory} is missing ${section}`);
      }
      assert.include(
        content,
        "../../references/scan-contract.md",
        `${directory} loads the contract`
      );
      assert.isTrue(
        next.some((marker) => content.includes(marker)),
        `${directory} must recommend one of ${next.join(", ")}`
      );
    }
  });

  it("keeps scan stages out of implementation and PR work", (): void => {
    for (const {directory} of SCAN_STAGES) {
      const content = readSkill(directory);
      assert.match(
        content,
        /never (edits|implement|invokes)|does not edit|never edits product code|never implements/i,
        `${directory} must state that it does not implement findings`
      );
    }
  });

  it("drives the campaign through the lifecycle without becoming a stage", (): void => {
    const content = readSkill("terreno-loop-campaign");
    assert.include(content, "name: terreno-loop-campaign");
    assert.include(content, "Not a stage");
    assert.include(content, "terreno-1-grow");
    assert.include(content, "terreno-4-brew");
    assert.include(content, "terreno-5-taste");
    assert.include(content, "genuine human decision");
    assert.include(content, "one exact question");
    assert.include(content, "native completion hook");
    assert.include(content, "../../references/scan-state.schema.json");
  });

  it("requires a measured metric before findings", (): void => {
    const contract = readFileSync(join(CANONICAL_DIRECTORY, "references/scan-contract.md"), "utf8");
    const tracking = readFileSync(join(CANONICAL_DIRECTORY, "references/goal-tracking.md"), "utf8");
    assert.include(contract, "Goal before findings");
    assert.include(tracking, "The exact command that prints the value");
    assert.include(tracking, "Re-baselining");
  });

  it("forbids silent truncation in the map-reduce procedure", (): void => {
    const mapreduce = readFileSync(join(CANONICAL_DIRECTORY, "references/mapreduce.md"), "utf8");
    assert.include(mapreduce, "silent truncation");
    assert.include(mapreduce, "Do not spawn nested workers");
  });

  it("publishes valid schemas for results, state, and findings", (): void => {
    for (const name of [
      "scan-result.schema.json",
      "scan-state.schema.json",
      "finding.schema.json",
    ]) {
      const schema = JSON.parse(
        readFileSync(join(CANONICAL_DIRECTORY, "references", name), "utf8")
      ) as {$id?: string; required?: string[]};
      assert.isString(schema.$id, `${name} needs an $id`);
      assert.isArray(schema.required, `${name} needs required keys`);
    }
  });

  it("registers the plugin on every host marketplace", (): void => {
    const marketplaces: Array<[string, (plugins: Array<Record<string, unknown>>) => boolean]> = [
      [
        ".cursor-plugin/marketplace.json",
        (plugins) => plugins.some((p) => p.name === "terreno-loop"),
      ],
      [
        ".claude-plugin/marketplace.json",
        (plugins) =>
          plugins.some(
            (p) => p.name === "terreno-loop" && p.source === "./plugins/terreno-loop-claude"
          ),
      ],
      [
        ".agents/plugins/marketplace.json",
        (plugins) => plugins.some((p) => p.name === "terreno-loop"),
      ],
    ];

    for (const [path, predicate] of marketplaces) {
      const marketplace = JSON.parse(readFileSync(join(ROOT_DIRECTORY, path), "utf8")) as {
        plugins?: Array<Record<string, unknown>>;
      };
      assert.isTrue(predicate(marketplace.plugins ?? []), `${path} must publish terreno-loop`);
    }
  });

  it("runs resident with a heartbeat that answers each comment once", (): void => {
    const content = readSkill("terreno-loop-run");
    assert.include(content, "name: terreno-loop-run");
    assert.include(content, "../../references/heartbeat.md");
    assert.include(content, "../../references/pr-routing.md");
    assert.include(content, "terreno-5-taste");
    assert.include(content, "wipLimit");
    assert.include(content, "one exact question");
    assert.include(content, "Stop conditions");
    assert.match(content, /prints nothing|Stay quiet/);

    const heartbeat = readFileSync(join(CANONICAL_DIRECTORY, "references/heartbeat.md"), "utf8");
    assert.include(heartbeat, "Answering exactly once");
    assert.include(heartbeat, "Choosing the interval");
    assert.include(heartbeat, "Never post a status comment");
    for (const bucket of [
      "unrouted",
      "answered",
      "broken",
      "bot-pending",
      "merged",
      "closed",
      "waiting",
    ]) {
      assert.include(heartbeat, bucket, `heartbeat must classify ${bucket}`);
    }
  });

  it("routes every PR to a named human", (): void => {
    const routing = readFileSync(join(CANONICAL_DIRECTORY, "references/pr-routing.md"), "utf8");
    for (const mode of ["fixed", "codeowners", "blame", "round-robin", "none"]) {
      assert.include(routing, mode, `routing must define the ${mode} mode`);
    }
    assert.include(routing, "gh pr edit");
    assert.include(routing, "Do not approve its own PRs");
    assert.include(routing, "mergePolicy");

    const aim = readSkill("terreno-loop-1-aim");
    assert.include(aim, "Settle review routing");
    assert.include(aim, "../../references/pr-routing.md");

    const plot = readSkill("terreno-loop-4-plot");
    assert.include(plot, "the reviewer and assignee this slice routes to");

    const state = JSON.parse(
      readFileSync(join(CANONICAL_DIRECTORY, "references/scan-state.schema.json"), "utf8")
    ) as {properties: {goal: {properties: Record<string, unknown>}}};
    assert.property(state.properties.goal.properties, "review");
  });

  it("generates a Claude copy with shortened scan and lifecycle names", (): void => {
    const files = buildClaudePluginFiles({rootDirectory: ROOT_DIRECTORY, target: SCAN_TARGET});
    const paths = files.map(({path}) => path);

    assert.include(paths, "skills/1-aim/SKILL.md");
    assert.include(paths, "skills/5-track/SKILL.md");
    assert.include(paths, "skills/campaign/SKILL.md");
    assert.include(paths, "skills/run/SKILL.md");
    assert.include(paths, "references/scan-contract.md");
    assert.notInclude(paths, "skills/terreno-loop-1-aim/SKILL.md");

    const aim = files.find(({path}) => path === "skills/1-aim/SKILL.md");
    assert.include(aim?.contents ?? "", "name: 1-aim");

    const loop = files.find(({path}) => path === "skills/run/SKILL.md");
    assert.include(loop?.contents ?? "", "name: run");
    assert.include(loop?.contents ?? "", "`5-taste`");
    assert.notInclude(loop?.contents ?? "", "terreno-loop-run");

    const campaign = files.find(({path}) => path === "skills/campaign/SKILL.md");
    assert.include(campaign?.contents ?? "", "name: campaign");
    assert.include(campaign?.contents ?? "", "`1-grow`");
    assert.notInclude(campaign?.contents ?? "", "terreno-1-grow");

    const manifest = JSON.parse(
      files.find(({path}) => path === ".claude-plugin/plugin.json")?.contents ?? "{}"
    ) as {agents?: string[]; name: string; skills: string};
    assert.equal(manifest.name, "terreno-loop");
    assert.equal(manifest.skills, "./skills/");
    assert.isUndefined(manifest.agents, "the scan plugin ships no agents");
  });

  it("installs through the skills tree", (): void => {
    for (const skillName of [
      ...SCAN_STAGES.map(({directory}) => directory),
      "terreno-loop-campaign",
      "terreno-loop-run",
    ]) {
      assert.isTrue(
        existsSync(join(ROOT_DIRECTORY, "skills", skillName, "SKILL.md")),
        `skills/${skillName} must be generated`
      );
    }
    assert.isTrue(
      existsSync(join(ROOT_DIRECTORY, "skills/terreno-loop-1-aim/references/scan-contract.md")),
      "linked plugin references must travel with the installable skill"
    );
  });
});
