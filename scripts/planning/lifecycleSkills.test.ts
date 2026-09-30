import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {assert} from "chai";
import {
  validateAsyncReviewBotsContract,
  validateClaudePluginHost,
  validateCodexPluginHost,
  validateDocumentationContract,
  validateGithubAttentionContract,
  validateLifecyclePlugin,
  validateOuterLoopContent,
  validatePrDeploymentsContract,
  validateProductCiContract,
  validateStageContent,
} from "./lifecycleSkills.ts";

const ROOT_DIRECTORY = resolve(import.meta.dir, "../..");

const readStage = (directory: string): string =>
  readFileSync(
    resolve(ROOT_DIRECTORY, "plugins/terreno-planning/skills", directory, "SKILL.md"),
    "utf8"
  );

const readGrilling = (): string =>
  readFileSync(
    resolve(
      ROOT_DIRECTORY,
      "plugins/terreno-planning/skills/terreno-1-grow/references/grilling.md"
    ),
    "utf8"
  );

const validateGrilling = (grillingContent: string): string[] =>
  validateStageContent({
    content: readStage("terreno-1-grow"),
    definition: {
      directory: "terreno-1-grow",
      nextMarkers: ["next: pick", "next: grow", "next: null"],
      stage: "grow",
    },
    grillingContent,
  });

describe("lifecycle skill architecture", (): void => {
  it("validates the real plugin lifecycle", (): void => {
    assert.deepEqual(validateLifecyclePlugin({rootDirectory: ROOT_DIRECTORY}), []);
  });

  it("defines the Terreno prepush gate as the local mirror of CI", (): void => {
    const packageJson = JSON.parse(
      readFileSync(resolve(ROOT_DIRECTORY, "package.json"), "utf8")
    ) as {scripts?: Record<string, string>};

    assert.equal(packageJson.scripts?.prepush, "bun run scripts/ci/prepush/run.ts");
  });

  it("validates the Claude Code plugin host", (): void => {
    assert.deepEqual(validateClaudePluginHost({rootDirectory: ROOT_DIRECTORY}), []);
    const claudeMarketplace = JSON.parse(
      readFileSync(resolve(ROOT_DIRECTORY, ".claude-plugin/marketplace.json"), "utf8")
    ) as {name: string; plugins: Array<{name: string}>};
    assert.equal(claudeMarketplace.name, "terreno-plugins");
    assert.equal(claudeMarketplace.plugins[0]?.name, "terreno");
    assert.notEqual(claudeMarketplace.name, claudeMarketplace.plugins[0]?.name);
  });

  it("validates the Codex plugin host", (): void => {
    assert.deepEqual(validateCodexPluginHost({rootDirectory: ROOT_DIRECTORY}), []);
    const codexMarketplace = JSON.parse(
      readFileSync(resolve(ROOT_DIRECTORY, ".agents/plugins/marketplace.json"), "utf8")
    ) as {
      name: string;
      plugins: Array<{name: string; source: {path: string; source: string}}>;
    };
    const codexManifest = JSON.parse(
      readFileSync(
        resolve(ROOT_DIRECTORY, "plugins/terreno-planning/.codex-plugin/plugin.json"),
        "utf8"
      )
    ) as {name: string; skills: string};

    assert.equal(codexMarketplace.name, "terreno-plugins");
    assert.equal(codexMarketplace.plugins[0]?.name, "terreno-planning");
    assert.equal(codexMarketplace.plugins[0]?.source.source, "local");
    assert.equal(codexMarketplace.plugins[0]?.source.path, "./plugins/terreno-planning");
    assert.equal(codexManifest.name, "terreno-planning");
    assert.equal(codexManifest.skills, "./skills/");
  });

  it("keeps canonical stage names for Cursor and npx skills", (): void => {
    const cursorPlugin = JSON.parse(
      readFileSync(
        resolve(ROOT_DIRECTORY, "plugins/terreno-planning/.cursor-plugin/plugin.json"),
        "utf8"
      )
    ) as {name: string};
    const cursorMarketplace = JSON.parse(
      readFileSync(resolve(ROOT_DIRECTORY, ".cursor-plugin/marketplace.json"), "utf8")
    ) as {plugins: Array<{name: string; source: string}>};

    assert.equal(cursorPlugin.name, "terreno-planning");
    assert.equal(cursorMarketplace.plugins[0]?.name, "terreno-planning");
    assert.equal(cursorMarketplace.plugins[0]?.source, "terreno-planning");
    assert.include(readStage("terreno-1-grow"), "name: terreno-1-grow");
  });

  it("rejects an unbounded Taste wait loop", (): void => {
    const errors = validateStageContent({
      content: `${readStage("terreno-5-taste")}\nKeep the loop active until all CI is green.`,
      definition: {
        directory: "terreno-5-taste",
        nextMarkers: ["next: taste", "next: null"],
        stage: "taste",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("unbounded waiting/loop")));
  });

  it("rejects Taste that hands a wait back to a directly invoking human", (): void => {
    const errors = validateStageContent({
      content: readStage("terreno-5-taste")
        .replaceAll("## Standalone entry", "## Exit")
        .replaceAll("Never hand a wait back to the human", "Tell the human to run Taste later")
        .replaceAll("at most 3 fix pushes", "any number of fix pushes"),
      definition: {
        directory: "terreno-5-taste",
        nextMarkers: ["next: taste", "next: null"],
        stage: "taste",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("standalone entry for direct human")));
    assert.isTrue(errors.some((error) => error.includes("must not return PENDING to a human")));
    assert.isTrue(errors.some((error) => error.includes("bounded by pushes and wait time")));
  });

  it("rejects Taste without a no-push emit path", (): void => {
    const errors = validateStageContent({
      content: readStage("terreno-5-taste").replace(
        "If step 10 did not push",
        "After step 10 pushed"
      ),
      definition: {
        directory: "terreno-5-taste",
        nextMarkers: ["next: taste", "next: null"],
        stage: "taste",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("emit path when no fix was pushed")));
  });

  it("rejects Brew that exits while review bots are running", (): void => {
    const content = readStage("terreno-4-brew")
      .replace("../../references/async-review-bots.md", "missing-bots")
      .replaceAll("Do not exit while", "Exit immediately while");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-4-brew",
        nextMarkers: ["next: taste"],
        stage: "brew",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("async review-bot wait")));
    assert.isTrue(
      errors.some((error) => error.includes("wait in-process for running review bots"))
    );
  });

  it("rejects Brew that skips product CI host discovery", (): void => {
    const content = readStage("terreno-4-brew")
      .replace("../../references/product-ci.md", "missing-product-ci")
      .replaceAll("every discovered CI host", "GitHub Actions only")
      .replaceAll("provider CLI watch hooks", "manual polling")
      .replaceAll("required host untriggered after grace", "untriggered hosts pass");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-4-brew",
        nextMarkers: ["next: taste"],
        stage: "brew",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("product-CI procedure")));
    assert.isTrue(errors.some((error) => error.includes("every discovered CI host")));
    assert.isTrue(errors.some((error) => error.includes("provider CLI watch hooks")));
    assert.isTrue(errors.some((error) => error.includes("required CI host")));
  });

  it("rejects Brew that rewrites the PR body as a turn summary", (): void => {
    const content = readStage("terreno-4-brew")
      .replace("IP's original justification", "latest implementation summary")
      .replace("reproducible testing instructions", "test status")
      .replace(
        "without rewriting the body around the latest turn",
        "by rewriting the body around the latest turn"
      );
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-4-brew",
        nextMarkers: ["next: taste"],
        stage: "brew",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("original justification")));
    assert.isTrue(errors.some((error) => error.includes("testing instructions")));
    assert.isTrue(errors.some((error) => error.includes("overview stable")));
  });

  it("rejects Taste that skips prepush, fallback checks, or the product-CI wait loop", (): void => {
    const content = readStage("terreno-5-taste")
      .replaceAll("fresh subagent", "same conversation")
      .replaceAll("no parent conversation", "full parent context")
      .replaceAll("package.json", "project manifest")
      .replaceAll("If no root `prepush` script exists", "Skip when no local gate exists")
      .replaceAll("prepush", "local gate")
      .replaceAll("repository's package manager", "hard-coded command")
      .replaceAll("lint script", "repo lint")
      .replaceAll("typecheck script", "build script")
      .replaceAll("locally affected tests", "the full suite")
      .replaceAll("latest `master`", "latest origin")
      .replaceAll("Before any push, in this order", "Before any push, optionally")
      .replaceAll("re-verify last-run failed tests", "skip local tests")
      .replaceAll("last-run failed tests", "some failing jobs")
      .replaceAll("If step 10 did not push", "Always emit after push")
      .replaceAll("gh pr checks <pr> --watch", "poll GitHub later")
      .replaceAll("circleci run watch --sha <sha>", "poll CircleCI later")
      .replaceAll("watch → snapshot cycle in a loop", "one snapshot then exit");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-5-taste",
        nextMarkers: ["next: taste", "next: null"],
        stage: "taste",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("fresh subagent")));
    assert.isTrue(errors.some((error) => error.includes("no parent conversation")));
    assert.isTrue(errors.some((error) => error.includes("root prepush")));
    assert.isTrue(errors.some((error) => error.includes("repository package manager")));
    assert.isTrue(errors.some((error) => error.includes("fallback checks")));
    assert.isTrue(errors.some((error) => error.includes("run lint")));
    assert.isTrue(errors.some((error) => error.includes("typecheck")));
    assert.isTrue(errors.some((error) => error.includes("locally affected tests")));
    assert.isTrue(errors.some((error) => error.includes("gh pr checks --watch")));
    assert.isTrue(errors.some((error) => error.includes("circleci run watch")));
    assert.isTrue(errors.some((error) => error.includes("watch loop")));
    assert.isTrue(errors.some((error) => error.includes("latest master")));
    assert.isTrue(
      errors.some((error) => error.includes("re-verify last-run failed tests, then local gate"))
    );
    assert.isTrue(errors.some((error) => error.includes("last-run failed tests from the CI")));
    assert.isTrue(
      errors.some((error) => error.includes("re-verify last-run failed tests locally"))
    );
  });

  it("rejects Taste that observes only GitHub checks", (): void => {
    const content = readStage("terreno-5-taste")
      .replace("../../references/product-ci.md", "missing-product-ci")
      .replaceAll("not only GitHub checks", "from GitHub checks only")
      .replaceAll("provider CLI watch hooks", "manual polling")
      .replaceAll("documented path-filter/config", "undocumented");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-5-taste",
        nextMarkers: ["next: taste", "next: null"],
        stage: "taste",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("product-CI procedure")));
    assert.isTrue(errors.some((error) => error.includes("not only GitHub checks")));
    assert.isTrue(errors.some((error) => error.includes("provider CLI watch hooks")));
    assert.isTrue(errors.some((error) => error.includes("non-applicable hosts")));
  });

  it("rejects same-invocation Brew to Taste execution", (): void => {
    const errors = validateStageContent({
      content: `${readStage("terreno-4-brew")}\nExecute Taste procedure now.`,
      definition: {
        directory: "terreno-4-brew",
        nextMarkers: ["next: taste"],
        stage: "brew",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("must not execute Taste")));
  });

  it("rejects repository-specific commands in portable stages", (): void => {
    const errors = validateStageContent({
      content: `${readStage("terreno-2-pick")}\nRun bun run lint.`,
      definition: {
        directory: "terreno-2-pick",
        nextMarkers: ["next: roast"],
        stage: "pick",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("repository-specific marker")));
  });

  it("rejects Pick that skips Roast or the inner loop", (): void => {
    const content = readStage("terreno-2-pick")
      .replaceAll("../../references/pick-roast-loop.md", "missing-loop")
      .replaceAll("Do not start the next task until Roast PASS", "Start the next task immediately")
      .replaceAll("Pick never skips Roast", "Pick may skip Roast");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-2-pick",
        nextMarkers: ["next: roast", "next: pick", "next: brew", "next: null"],
        stage: "pick",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("pick-roast inner loop")));
    assert.isTrue(errors.some((error) => error.includes("Roast PASS before the next task")));
    assert.isTrue(errors.some((error) => error.includes("must not skip Roast")));
  });

  it("rejects Pick that skips Reconstruct on the next task or dual-drives the loop", (): void => {
    const content = readStage("terreno-2-pick")
      .replaceAll("repeat from Reconstruct", "repeat from Specify")
      .replaceAll("Exactly one driver continues", "Both Pick and Roast continue")
      .replaceAll("Roast never invokes Pick", "Roast may invoke Pick");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-2-pick",
        nextMarkers: ["next: roast", "next: pick", "next: brew", "next: null"],
        stage: "pick",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("rediscover docs and skills")));
    assert.isTrue(errors.some((error) => error.includes("single inner-loop driver")));
    assert.isTrue(errors.some((error) => error.includes("treat Roast as prove-only")));
  });

  it("rejects Pick that skips the subagent briefing contract", (): void => {
    const content = readStage("terreno-2-pick")
      .replace("../../references/subagent-briefing.md", "missing-briefing")
      .replaceAll("task-scoped briefing", "full-repo rediscovery");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-2-pick",
        nextMarkers: ["next: roast", "next: pick", "next: brew", "next: null"],
        stage: "pick",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("subagent briefing contract")));
    assert.isTrue(errors.some((error) => error.includes("task-scoped briefing")));
  });

  it("rejects Roast that invokes Pick or dual-drives the loop", (): void => {
    const content = readStage("terreno-3-roast")
      .replaceAll("Exactly one driver continues", "Both stages continue")
      .replaceAll("Roast never invokes Pick", "Roast may invoke Pick")
      .replaceAll("Pick owns the inner loop", "Roast owns the inner loop");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-3-roast",
        nextMarkers: ["next: brew", "next: pick", "next: null"],
        stage: "roast",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("single inner-loop driver")));
    assert.isTrue(errors.some((error) => error.includes("never invoke Pick")));
    assert.isTrue(errors.some((error) => error.includes("Pick as the inner-loop driver")));
  });

  it("rejects Roast that skips the subagent briefing contract", (): void => {
    const content = readStage("terreno-3-roast")
      .replace("../../references/subagent-briefing.md", "missing-briefing")
      .replaceAll("Do not spawn two unconstrained reviewers", "Spawn two unconstrained reviewers")
      .replaceAll("task-scoped briefing", "full-repo rediscovery");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-3-roast",
        nextMarkers: ["next: brew", "next: pick", "next: null"],
        stage: "roast",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("subagent briefing contract")));
    assert.isTrue(errors.some((error) => error.includes("unconstrained dual reviewers")));
    assert.isTrue(errors.some((error) => error.includes("task-scoped briefing")));
  });

  it("rejects Roast that does not continue the inner loop", (): void => {
    const content = readStage("terreno-3-roast")
      .replace("../../references/pick-roast-loop.md", "missing-loop")
      .replaceAll("Do not start the next task until Roast PASS", "Hand off to Brew after one task");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-3-roast",
        nextMarkers: ["next: brew", "next: pick", "next: null"],
        stage: "roast",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("pick-roast inner loop")));
    assert.isTrue(errors.some((error) => error.includes("Roast PASS before the next task")));
  });

  it("rejects a missing non-pass transition marker", (): void => {
    const content = readStage("terreno-1-grow").replace("next: grow", "missing-grow-retry");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-1-grow",
        nextMarkers: ["next: pick", "next: grow"],
        stage: "grow",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("next: grow")));
  });

  it("rejects verbose or incomplete GitHub communication contracts", (): void => {
    const errors = validateGithubAttentionContract(`
## Summary
## What changed
## Verification
`);

    assert.isTrue(errors.some((error) => error.includes("missing required heading ## Why")));
    assert.isTrue(errors.some((error) => error.includes("forbidden heading ## Summary")));
    assert.isTrue(errors.some((error) => error.includes("default PR comments to silence")));
    assert.isTrue(errors.some((error) => error.includes("behind disclosure")));
    assert.isTrue(errors.some((error) => error.includes("preview URLs")));
    assert.isTrue(errors.some((error) => error.includes("[FH-1632]")));
    assert.isTrue(errors.some((error) => error.includes("[#412]")));
    assert.isTrue(errors.some((error) => error.includes("IP Approved")));
    assert.isTrue(errors.some((error) => error.includes("feat:")));
    assert.isTrue(errors.some((error) => error.includes("initial justification")));
    assert.isTrue(errors.some((error) => error.includes("overview of the approved IP")));
    assert.isTrue(errors.some((error) => error.includes("testing instructions")));
    assert.isTrue(errors.some((error) => error.includes("stable across turns")));
  });

  it("rejects a documentation contract that does not require reading and updating docs", (): void => {
    const errors = validateDocumentationContract("# Docs\nWrite something later.");

    assert.isTrue(errors.some((error) => error.includes("Always read docs first")));
    assert.isTrue(errors.some((error) => error.includes("Always update docs")));
    assert.isTrue(errors.some((error) => error.includes("Diátaxis")));
  });

  it("rejects product CI polling without native wait hooks", (): void => {
    const errors = validateProductCiContract(
      "Fetch status, sleep 30 seconds, then fetch status again."
    );

    assert.isTrue(errors.some((error) => error.includes("gh pr checks")));
    assert.isTrue(errors.some((error) => error.includes("circleci run watch")));
    assert.isTrue(errors.some((error) => error.includes("bk build watch")));
    assert.isTrue(errors.some((error) => error.includes("final fallback")));
    assert.isTrue(errors.some((error) => error.includes("untriggered hosts")));
    assert.isTrue(errors.some((error) => error.includes("non-applicable hosts")));
    assert.isTrue(errors.some((error) => error.includes("last-run failed tests")));
  });

  it("rejects review-bot waits that watch every PR check", (): void => {
    const missingErrors = validateAsyncReviewBotsContract("");
    const unsafeErrors = validateAsyncReviewBotsContract(
      "Prefer `gh pr checks <pr> --watch --interval 30` or gh run watch <run-id> --exit-status."
    );

    assert.isTrue(missingErrors.some((error) => error.includes("targeted GitHub Actions")));
    assert.isTrue(missingErrors.some((error) => error.includes("unfiltered PR-check")));
    assert.isTrue(missingErrors.some((error) => error.includes("PR-event subscriptions")));
    assert.isTrue(unsafeErrors.some((error) => error.includes("all PR product checks")));
    assert.isTrue(unsafeErrors.some((error) => error.includes("bot failure")));
  });

  it("rejects a PR deployments contract that hides demo URLs", (): void => {
    const errors = validatePrDeploymentsContract("Mention previews somewhere in the recap.");

    assert.isTrue(errors.some((error) => error.includes("last visible section")));
    assert.isTrue(errors.some((error) => error.includes("environmentUrl")));
    assert.isTrue(errors.some((error) => error.includes("Do not wait for")));
    assert.isTrue(errors.some((error) => error.includes("PR comment")));
    assert.isTrue(errors.some((error) => error.includes("list GitHub Deployments")));
  });

  it("rejects a stage that does not load the documentation contract", (): void => {
    const content = readStage("terreno-2-pick").replace(
      "../../references/documentation-contract.md",
      "missing-docs-contract"
    );
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-2-pick",
        nextMarkers: ["next: roast"],
        stage: "pick",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("documentation contract")));
  });

  it("rejects a stage that does not load the PR deployments closer", (): void => {
    const content = readStage("terreno-4-brew").replace(
      "../../references/pr-deployments.md",
      "missing-pr-deployments"
    );
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-4-brew",
        nextMarkers: ["next: taste"],
        stage: "brew",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("PR deployments chat closer")));
  });

  it("rejects Grow that skips grilling or the Decisions table", (): void => {
    const content = readStage("terreno-1-grow")
      .replace("references/grilling.md", "missing-grilling")
      .replace("Decisions table", "compressed one-liner");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-1-grow",
        nextMarkers: ["next: pick", "next: grow", "next: null"],
        stage: "grow",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("grilling procedure")));
    assert.isTrue(errors.some((error) => error.includes("Decisions table")));
  });

  it("rejects Grow that drops the approval brief or the prompting questions", (): void => {
    const content = readStage("terreno-1-grow")
      .replaceAll("approval brief", "approval index")
      .replaceAll("question that prompted", "chosen answer");
    const errors = validateStageContent({
      content,
      definition: {
        directory: "terreno-1-grow",
        nextMarkers: ["next: pick", "next: grow", "next: null"],
        stage: "grow",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("standalone approval brief")));
    assert.isTrue(errors.some((error) => error.includes("question that prompted them")));
  });

  it("accepts the real grilling approval brief", (): void => {
    assert.deepEqual(validateGrilling(readGrilling()), []);
  });

  it("rejects an approval brief that leads with decisions instead of the plan", (): void => {
    const content = readGrilling()
      .replace("## The plan", "## Deferred plan")
      .replace("## Decisions", "## Decisions\n\n## The plan");

    assert.isTrue(
      validateGrilling(content).some((error) =>
        error.includes("must come before the Decisions table")
      )
    );
  });

  it("rejects an approval brief that drops orientation, questions, or the row cap", (): void => {
    const content = readGrilling()
      .replace("## The idea", "## Implementation notes")
      .replace("| ID | Question asked | Answer |", "| ID | Decision | Choice |")
      .replace("no row limit", "at most five rows");
    const errors = validateGrilling(content);

    assert.isTrue(errors.some((error) => error.includes("## The idea")));
    assert.isTrue(errors.some((error) => error.includes("question that prompted each choice")));
    assert.isTrue(errors.some((error) => error.includes("stay unbounded")));
  });

  it("rejects a grilling procedure with no approval brief at all", (): void => {
    const errors = validateGrilling(
      readGrilling().replace("## Approval brief", "## Approval summary")
    );

    assert.deepEqual(errors, [
      "grilling: Grow's approval output must be a standalone approval brief",
    ]);
  });

  it("rejects a stage that still disables model invocation", (): void => {
    const errors = validateStageContent({
      content: `${readStage("terreno-1-grow")}\ndisable-model-invocation: true`,
      definition: {
        directory: "terreno-1-grow",
        nextMarkers: ["next: pick", "next: grow", "next: null"],
        stage: "grow",
      },
    });

    assert.isTrue(errors.some((error) => error.includes("must allow model invocation")));
  });

  it("keeps all outer loops as non-stage plugin skills", (): void => {
    for (const directory of [
      "terreno-pick-roast-loop",
      "terreno-planning-loop",
      "terreno-taste-sweep",
    ] as const) {
      const content = readStage(directory);
      assert.include(content, `name: ${directory}`);
      assert.notInclude(content, "disable-model-invocation: true");
      assert.include(content, "../../references/lifecycle-contract.md");
      assert.deepEqual(validateOuterLoopContent({content, directory}), []);
    }
  });

  it("rejects a Pick-Roast outer loop that stops on ordinary failures", (): void => {
    const content = readStage("terreno-pick-roast-loop")
      .replace("Ordinary test failures", "Test failures")
      .replace("one exact question", "a question")
      .replace("Do not stream a recap after each cycle", "Stream every cycle")
      .replaceAll("next.stage", "always-pick")
      .replace("only when it is pick or roast", "whenever next is set")
      .replace("Do not invoke Brew", "May invoke Brew")
      .replace("same task-scoped briefing every time", "briefing is optional")
      .replace("../../references/execution-state.schema.json", "missing-state-schema");
    const errors = validateOuterLoopContent({
      content,
      directory: "terreno-pick-roast-loop",
    });

    assert.isTrue(errors.some((error) => error.includes("Ordinary test failures")));
    assert.isTrue(errors.some((error) => error.includes("one exact question")));
    assert.isTrue(errors.some((error) => error.includes("Do not stream a recap")));
    assert.isTrue(errors.some((error) => error.includes("next.stage")));
    assert.isTrue(errors.some((error) => error.includes("only when it is pick or roast")));
    assert.isTrue(errors.some((error) => error.includes("Do not invoke Brew")));
    assert.isTrue(errors.some((error) => error.includes("same task-scoped briefing")));
    assert.isTrue(errors.some((error) => error.includes("execution-state.schema.json")));
  });

  it("rejects outer loops that use timers before native CI hooks", (): void => {
    const errors = validateOuterLoopContent({
      content: "Wait 120 seconds, then invoke Taste.",
      directory: "terreno-planning-loop",
    });

    assert.isTrue(errors.some((error) => error.includes("product-CI procedure")));
    assert.isTrue(errors.some((error) => error.includes("native watch hooks")));
    assert.isTrue(errors.some((error) => error.includes("timer waiting")));
  });
});
