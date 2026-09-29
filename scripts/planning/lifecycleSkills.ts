import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

const LIFECYCLE_STAGES = ["grow", "pick", "roast", "brew", "taste"] as const;
const RESULT_STATUSES = ["PASS", "FAIL", "BLOCKED", "PENDING"] as const;

interface StageDefinition {
  directory: string;
  nextMarkers: string[];
  stage: (typeof LIFECYCLE_STAGES)[number];
}

interface ValidateLifecyclePluginOptions {
  rootDirectory: string;
}

interface ValidateStageContentOptions {
  content: string;
  definition: StageDefinition;
  grillingContent?: string;
}

interface TextFile {
  content: string;
  path: string;
}

const PR_HEADINGS = ["## Why", "## What changed", "## Verification"];
const PR_FORBIDDEN_HEADINGS = [
  "## Summary",
  "## Related IP or issue",
  "## Type of change",
  "## Testing performed",
  "## Checklist",
];

const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    directory: "terreno-1-grow",
    nextMarkers: ["next: pick", "next: grow", "next: null"],
    stage: "grow",
  },
  {
    directory: "terreno-2-pick",
    nextMarkers: ["next: roast", "next: pick", "next: brew", "next: null"],
    stage: "pick",
  },
  {
    directory: "terreno-3-roast",
    nextMarkers: ["next: brew", "next: pick", "next: null"],
    stage: "roast",
  },
  {
    directory: "terreno-4-brew",
    nextMarkers: ["next: taste", "next: pick", "next: roast", "next: brew", "next: null"],
    stage: "brew",
  },
  {
    directory: "terreno-5-taste",
    nextMarkers: ["next: taste", "next: null"],
    stage: "taste",
  },
];

const OUTER_LOOP_DIRECTORIES = [
  "terreno-pick-roast-loop",
  "terreno-planning-loop",
  "terreno-taste-sweep",
] as const;

const PLUGIN_APP_SKILL_DIRECTORIES = [
  "ai-prompt-governance",
  "backend-test-env",
  "building-admin-interfaces",
  "building-terreno-apps",
  "debug-syncdb-with-mcp",
  "deploy-gcp",
  "generate-release-announcements",
  "generate-sdk",
  "mongoose-schema-safety",
  "terreno-backend-api",
  "terreno-data-fetching",
  "terreno-ui",
  "update-docs",
  "upgrading-terreno",
  "verify-ui-changes",
] as const;

const PLUGIN_AGENT_NAMES = ["pre-commit", "ui-verifier"] as const;

const GRILLING_BRIEF_HEADINGS = [
  "## Background",
  "## The idea",
  "## The plan",
  "## Decisions",
] as const;

const REMOVED_SKILL_DIRECTORIES = [
  "add-app-clip",
  "building-native-ui",
  "commit",
  "create-pr",
  "eas-update-insights",
  "expo-brownfield",
  "expo-module",
  "expo-observe",
  "expo-tailwind-setup",
  "expo-ui",
  "native-data-fetching",
] as const;

const REQUIRED_SECTIONS = [
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

const RETIRED_IDENTIFIERS = [
  "terreno-1-blend",
  "terreno-2-roast",
  "terreno-3-cupping",
  "terreno-4-pour",
  "terreno-5-dialin",
];

const TASTE_UNBOUNDED_LOOP_PATTERNS = [
  /keep the loop active/i,
  /continue the loop/i,
  /do not exit until all checks pass/i,
  /wait until all CI is green/i,
];

const PORTABILITY_MARKERS = [
  "@terreno/",
  "example-frontend",
  "admin-frontend",
  "bun run",
  "MongoMemoryServer",
  "docs/implementationPlans",
];

const readMarkdownFiles = (directory: string): TextFile[] => {
  const files: TextFile[] = [];

  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...readMarkdownFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({content: readFileSync(path, "utf8"), path});
    }
  }

  return files;
};

export const validateStageContent = ({
  content,
  definition,
  grillingContent,
}: ValidateStageContentOptions): string[] => {
  const errors: string[] = [];
  const prefix = definition.directory;

  if (!content.includes(`name: ${definition.directory}`)) {
    errors.push(`${prefix}: frontmatter name must match its canonical directory`);
  }

  if (content.includes("disable-model-invocation: true")) {
    errors.push(`${prefix}: lifecycle skills must allow model invocation`);
  }

  if (!content.includes("../../references/lifecycle-contract.md")) {
    errors.push(`${prefix}: must load the shared lifecycle contract`);
  }

  if (!content.includes("../../references/pr-deployments.md")) {
    errors.push(`${prefix}: must load the PR deployments chat closer`);
  }

  if (!content.includes("../../references/documentation-contract.md")) {
    errors.push(`${prefix}: must load the shared documentation contract`);
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`${prefix}: missing section ${section}`);
    }
  }

  for (const marker of definition.nextMarkers) {
    if (!content.includes(marker)) {
      errors.push(`${prefix}: missing transition marker ${marker}`);
    }
  }

  for (const marker of PORTABILITY_MARKERS) {
    if (content.includes(marker)) {
      errors.push(`${prefix}: repository-specific marker belongs in a project skill: ${marker}`);
    }
  }

  if (definition.stage === "grow") {
    if (!content.includes("references/grilling.md")) {
      errors.push(`${prefix}: Grow must load the grilling procedure`);
    }
    if (!content.includes("Decisions table")) {
      errors.push(`${prefix}: Grow must list grilled decisions in a Decisions table`);
    }
    if (!content.includes("approval brief")) {
      errors.push(`${prefix}: Grow must end with a standalone approval brief`);
    }
    if (!content.includes("question that prompted")) {
      errors.push(`${prefix}: Grow decisions must carry the question that prompted them`);
    }
    if (grillingContent) {
      errors.push(...validateGrillingProcedure(grillingContent));
    }
  }

  if (definition.stage === "pick" || definition.stage === "roast") {
    if (!content.includes("../../references/pick-roast-loop.md")) {
      errors.push(`${prefix}: must load the pick-roast inner loop`);
    }
    if (!content.includes("Do not start the next task until Roast PASS")) {
      errors.push(`${prefix}: must require Roast PASS before the next task`);
    }
  }

  if (definition.stage === "pick") {
    if (!content.includes("Pick never skips Roast")) {
      errors.push(`${prefix}: Pick must not skip Roast`);
    }
    if (!content.includes("repeat from Reconstruct")) {
      errors.push(`${prefix}: must rediscover docs and skills on the next task`);
    }
    if (!content.includes("Exactly one driver continues")) {
      errors.push(`${prefix}: must name a single inner-loop driver`);
    }
    if (!content.includes("Roast never invokes Pick")) {
      errors.push(`${prefix}: Pick must treat Roast as prove-only`);
    }
    if (!content.includes("../../references/subagent-briefing.md")) {
      errors.push(`${prefix}: must load the subagent briefing contract`);
    }
    if (!content.includes("task-scoped briefing")) {
      errors.push(`${prefix}: must pass a task-scoped briefing to Roast and reviewers`);
    }
    if (!content.includes("**Commit once.**")) {
      errors.push(`${prefix}: Pick must make one commit per task after Roast PASS`);
    }
    if (!content.includes("List its edge cases before writing code")) {
      errors.push(`${prefix}: Pick must enumerate edge cases before implementing`);
    }
    if (!content.includes("Do not start or continue another slice on a red head")) {
      errors.push(`${prefix}: Pick must fix branch-caused CI failures before the next slice`);
    }
    if (!content.includes("Never wait on pending CI")) {
      errors.push(`${prefix}: Pick must not wait on pending CI`);
    }
  }

  if (definition.stage === "roast") {
    if (!content.includes("passes alone but fails in the package suite")) {
      errors.push(`${prefix}: Roast must run the CI-equivalent package gate`);
    }
    if (!content.includes("Exactly one driver continues")) {
      errors.push(`${prefix}: must name a single inner-loop driver`);
    }
    if (!content.includes("Roast never invokes Pick")) {
      errors.push(`${prefix}: Roast must never invoke Pick`);
    }
    if (!content.includes("Pick owns the inner loop")) {
      errors.push(`${prefix}: Roast must name Pick as the inner-loop driver`);
    }
    if (!content.includes("../../references/subagent-briefing.md")) {
      errors.push(`${prefix}: must load the subagent briefing contract`);
    }
    if (!content.includes("Do not spawn two unconstrained reviewers")) {
      errors.push(`${prefix}: must forbid unconstrained dual reviewers`);
    }
    if (!content.includes("task-scoped briefing")) {
      errors.push(`${prefix}: must require a task-scoped briefing`);
    }
  }

  if (definition.stage === "brew") {
    if (!content.includes("../../references/github-attention-contract.md")) {
      errors.push(`${prefix}: Brew must load the GitHub attention contract`);
    }
    if (!content.includes("[ticket] Short feature title")) {
      errors.push(`${prefix}: Brew must set PR titles to [ticket] Short feature title`);
    }
    if (!content.includes("IP's original justification")) {
      errors.push(`${prefix}: Brew must preserve the IP's original justification in the PR body`);
    }
    if (!content.includes("reproducible testing instructions")) {
      errors.push(`${prefix}: Brew must always include reproducible testing instructions`);
    }
    if (!content.includes("without rewriting the body around the latest turn")) {
      errors.push(`${prefix}: Brew must keep the PR overview stable across testing updates`);
    }
    if (!content.includes("../../references/async-review-bots.md")) {
      errors.push(`${prefix}: Brew must load the async review-bot wait procedure`);
    }
    if (!content.includes("../../references/product-ci.md")) {
      errors.push(`${prefix}: Brew must load the product-CI procedure`);
    }
    if (!content.includes("every discovered CI host")) {
      errors.push(`${prefix}: Brew must confirm product CI on every discovered CI host`);
    }
    if (!content.includes("Do not exit while")) {
      errors.push(`${prefix}: Brew must wait in-process for running review bots`);
    }
    if (!content.includes("provider CLI watch hooks")) {
      errors.push(`${prefix}: Brew must prefer provider CLI watch hooks over sleep polling`);
    }
    if (!content.includes("required host untriggered after grace")) {
      errors.push(`${prefix}: Brew must fail when a required CI host remains untriggered`);
    }
    if (!content.includes("Brew itself never executes Taste")) {
      errors.push(`${prefix}: must explicitly terminate without executing Taste`);
    }
    if (!content.includes("start the Taste skill as the next stage")) {
      errors.push(`${prefix}: Brew must hand a direct human invocation on to Taste`);
    }
    if (/execute(?:s| the)? \*\*?Taste|execute(?:s| the)? Taste procedure/i.test(content)) {
      errors.push(`${prefix}: Brew must not execute Taste in the same invocation`);
    }
  }

  if (definition.stage === "taste") {
    if (!content.includes("../../references/github-attention-contract.md")) {
      errors.push(`${prefix}: Taste must load the GitHub attention contract`);
    }
    if (!content.includes("../../references/async-review-bots.md")) {
      errors.push(`${prefix}: Taste must load the async review-bot wait procedure`);
    }
    if (!content.includes("../../references/product-ci.md")) {
      errors.push(`${prefix}: Taste must load the product-CI procedure`);
    }
    if (!content.includes("not only GitHub checks")) {
      errors.push(
        `${prefix}: Taste must observe jobs on every discovered CI host, not only GitHub checks`
      );
    }
    if (!content.includes("Do not exit while")) {
      errors.push(`${prefix}: Taste must wait in-process for running review bots`);
    }
    if (!content.includes("provider CLI watch hooks")) {
      errors.push(`${prefix}: Taste must prefer provider CLI watch hooks over sleep polling`);
    }
    if (!content.includes("documented path-filter/config")) {
      errors.push(`${prefix}: Taste must treat documented non-applicable hosts as skipped`);
    }
    if (!content.includes("one reactive iteration only")) {
      errors.push(`${prefix}: must be bounded to one reactive iteration`);
    }
    if (!content.includes("## Standalone entry")) {
      errors.push(`${prefix}: Taste must define standalone entry for direct human invocation`);
    }
    if (!content.includes("Never hand a wait back to the human")) {
      errors.push(`${prefix}: Taste must not return PENDING to a human`);
    }
    if (!content.includes("at most 3 fix pushes") || !content.includes("at most 3 hours")) {
      errors.push(`${prefix}: Taste standalone entry must be bounded by pushes and wait time`);
    }
    if (!content.includes("If step 10 did not push")) {
      errors.push(`${prefix}: Taste must preserve an emit path when no fix was pushed`);
    }
    if (!content.includes("latest `master`")) {
      errors.push(`${prefix}: Taste must fetch latest master before the local gate and push`);
    }
    if (!content.includes("Otherwise skip the merge")) {
      errors.push(`${prefix}: Taste must merge the base only when needed`);
    }
    if (!content.includes("Before any push, in this order")) {
      errors.push(
        `${prefix}: Taste must order before-push as pull, then re-verify last-run failed tests, then local gate, then watch`
      );
    }
    if (!content.includes("last-run failed tests")) {
      errors.push(`${prefix}: Taste must record last-run failed tests from the CI snapshot`);
    }
    if (!content.includes("re-verify last-run failed tests")) {
      errors.push(`${prefix}: Taste must re-verify last-run failed tests locally before push`);
    }
    if (!content.includes("fresh subagent")) {
      errors.push(`${prefix}: Taste must spawn a fresh subagent for the local pre-push gate`);
    }
    if (!content.includes("no parent conversation")) {
      errors.push(`${prefix}: Taste's pre-push subagent must have no parent conversation`);
    }
    if (!content.includes("package.json") || !content.includes("prepush")) {
      errors.push(`${prefix}: Taste must run the root prepush package script when present`);
    }
    if (!content.includes("repository's package manager")) {
      errors.push(`${prefix}: Taste must invoke prepush with the repository package manager`);
    }
    if (!content.includes("If no root `prepush` script exists")) {
      errors.push(`${prefix}: Taste must retain affected-package fallback checks`);
    }
    if (!content.includes("lint script")) {
      errors.push(`${prefix}: Taste fallback must run lint in each affected package`);
    }
    if (!content.includes("typecheck script")) {
      errors.push(`${prefix}: Taste must run a typecheck in each affected package`);
    }
    if (!content.includes("locally affected tests")) {
      errors.push(`${prefix}: Taste must run locally affected tests before push`);
    }
    if (!content.includes("gh pr checks <pr> --watch")) {
      errors.push(`${prefix}: Taste must wait for GitHub product CI with gh pr checks --watch`);
    }
    if (!content.includes("circleci run watch --sha <sha>")) {
      errors.push(`${prefix}: Taste must wait for CircleCI with circleci run watch`);
    }
    if (!content.includes("watch → snapshot cycle in a loop")) {
      errors.push(`${prefix}: Taste must wait for product CI in a watch loop`);
    }
    for (const pattern of TASTE_UNBOUNDED_LOOP_PATTERNS) {
      if (pattern.test(content)) {
        errors.push(`${prefix}: contains an unbounded waiting/loop pattern: ${pattern.source}`);
      }
    }
  }

  return errors;
};

const validateGrillingProcedure = (content: string): string[] => {
  const errors: string[] = [];

  if (!content.includes("## Approval brief")) {
    errors.push("grilling: Grow's approval output must be a standalone approval brief");
    return errors;
  }

  for (const heading of GRILLING_BRIEF_HEADINGS) {
    if (!content.includes(heading)) {
      errors.push(`grilling: approval brief must include ${heading}`);
    }
  }

  const planIndex = content.indexOf("## The plan");
  const decisionsIndex = content.indexOf("## Decisions");
  if (planIndex >= 0 && decisionsIndex >= 0 && planIndex > decisionsIndex) {
    errors.push("grilling: the idea and the plan must come before the Decisions table");
  }

  if (!content.includes("| ID | Question asked | Answer |")) {
    errors.push("grilling: the Decisions table must record the question that prompted each choice");
  }

  if (!content.includes("no row limit")) {
    errors.push("grilling: the Decisions table must stay unbounded");
  }

  return errors;
};

export const validateDocumentationContract = (content: string): string[] => {
  const errors: string[] = [];
  const requiredPhrases = [
    "Always read docs first",
    "Always update docs",
    "Diátaxis",
    "Missing docs for a user-visible or architectural change is `FAIL`",
  ];

  for (const phrase of requiredPhrases) {
    if (!content.includes(phrase)) {
      errors.push(`Documentation contract is missing required phrase: ${phrase}`);
    }
  }

  return errors;
};

export const validateGithubAttentionContract = (content: string): string[] => {
  const errors: string[] = [];

  for (const heading of PR_HEADINGS) {
    if (!content.includes(heading)) {
      errors.push(`GitHub attention contract is missing required heading ${heading}`);
    }
  }

  for (const heading of PR_FORBIDDEN_HEADINGS) {
    if (content.includes(heading)) {
      errors.push(`GitHub attention contract contains forbidden heading ${heading}`);
    }
  }

  if (!content.includes("Default to silence")) {
    errors.push("GitHub attention contract must default PR comments to silence");
  }
  if (!content.includes("preview/demo URLs")) {
    errors.push("GitHub attention contract must keep preview URLs out of PR comments");
  }
  if (!content.includes("<details>")) {
    errors.push("GitHub attention contract must put optional detail behind disclosure");
  }
  if (!content.includes("[FH-1632]")) {
    errors.push("GitHub attention contract must show Linear ticket title format [FH-1632]");
  }
  if (!content.includes("[#412]")) {
    errors.push("GitHub attention contract must show GitHub issue title format [#412]");
  }
  if (!content.includes("IP Approved")) {
    errors.push("GitHub attention contract must forbid lifecycle labels such as IP Approved");
  }
  if (!content.includes("feat:")) {
    errors.push("GitHub attention contract must forbid conventional-commit prefixes such as feat:");
  }
  if (!content.includes("IP's initial justification")) {
    errors.push("GitHub attention contract must preserve the IP's initial justification");
  }
  if (!content.includes("overview of the approved IP")) {
    errors.push("GitHub attention contract must include an overview of the approved IP");
  }
  if (!content.includes("Always include executable testing instructions")) {
    errors.push("GitHub attention contract must always include executable testing instructions");
  }
  if (!content.includes("Do not regenerate the rest of the body from the latest turn")) {
    errors.push("GitHub attention contract must keep the PR body stable across turns");
  }

  return errors;
};

export const validateProductCiContract = (content: string): string[] => {
  const errors: string[] = [];
  for (const nativeWait of [
    "gh pr checks <pr> --watch",
    "circleci run watch --sha <sha>",
    "bk build watch <build-number>",
  ]) {
    if (!content.includes(nativeWait)) {
      errors.push(`product-CI procedure is missing native wait hook: ${nativeWait}`);
    }
  }
  if (!content.includes("Only then fall back to bounded")) {
    errors.push("product-CI procedure must make sleep polling the final fallback");
  }
  for (const nonBlockingQuery of [
    "circleci run list --branch <branch> --json",
    "bk build list --commit <sha> --json",
  ]) {
    if (!content.includes(nonBlockingQuery)) {
      errors.push(`product-CI procedure is missing non-blocking stage query: ${nonBlockingQuery}`);
    }
  }
  if (!content.includes("Taste waits in-process with these blocking watch hooks")) {
    errors.push("product-CI procedure must wait in-process in Taste with blocking watch hooks");
  }
  if (!content.includes("Never emit Brew `PASS`")) {
    errors.push("product-CI procedure must reject unexplained untriggered hosts");
  }
  if (!content.includes("counts as terminal `skipped`")) {
    errors.push("product-CI procedure must terminate documented non-applicable hosts");
  }
  if (!content.includes("## Last-run failed tests")) {
    errors.push("product-CI procedure must record last-run failed tests");
  }
  if (!content.includes("re-verifies them locally before any push")) {
    errors.push("product-CI procedure must re-verify last-run failed tests before push");
  }
  return errors;
};

export const validateAsyncReviewBotsContract = (content: string): string[] => {
  const errors: string[] = [];
  if (!content.includes("gh run watch <run-id>")) {
    errors.push("review-bot procedure must use targeted GitHub Actions run watching");
  }
  if (!content.includes("Do **not** use unfiltered")) {
    errors.push("review-bot procedure must forbid unfiltered PR-check watching");
  }
  if (!content.includes("harness PR-event subscription")) {
    errors.push("review-bot procedure must prefer harness PR-event subscriptions");
  }
  if (content.includes("`gh pr checks <pr> --watch")) {
    errors.push("review-bot procedure must not wait on all PR product checks");
  }
  if (content.includes("gh run watch <run-id> --exit-status")) {
    errors.push("review-bot procedure must not turn a bot failure into Brew command failure");
  }
  return errors;
};

export const validatePrDeploymentsContract = (content: string): string[] => {
  const errors: string[] = [];
  for (const phrase of [
    "last visible section",
    "environmentUrl",
    "Do not wait for",
    "Do not post the links as a PR comment",
    'Do not write "no deployments."',
    "## Demo",
  ]) {
    if (!content.includes(phrase)) {
      errors.push(`PR deployments contract is missing required phrase: ${phrase}`);
    }
  }
  if (!content.includes("gh api graphql") && !content.includes('gh api "')) {
    errors.push("PR deployments contract must show how to list GitHub Deployments");
  }
  return errors;
};

export const validateOuterLoopContent = ({
  content,
  directory,
}: {
  content: string;
  directory: string;
}): string[] => {
  const errors: string[] = [];
  if (content.includes("disable-model-invocation: true")) {
    errors.push(`${directory}: outer-loop skills must allow model invocation`);
  }
  if (!content.includes("../../references/pr-deployments.md")) {
    errors.push(`${directory}: outer loop must load the PR deployments chat closer`);
  }
  if (directory === "terreno-pick-roast-loop") {
    for (const marker of [
      "../../references/pick-roast-loop.md",
      "../../references/execution-state.schema.json",
      "genuine human decision",
      "Run ledger",
      "Completion report",
      "Do not stream a recap after each cycle",
      "Ordinary test failures",
      "one exact question",
      "Never invoke Brew or Taste",
      "Do not silently run Grow",
      "next.stage",
      "only when it is pick or roast",
      "Do not invoke Brew",
      "same task-scoped briefing every time",
    ]) {
      if (!content.includes(marker)) {
        errors.push(`${directory}: missing continuous-loop marker ${marker}`);
      }
    }
    if (content.includes("../../references/product-ci.md")) {
      errors.push(`${directory}: focused Pick-Roast loop must not load product CI`);
    }
    return errors;
  }
  if (!content.includes("../../references/product-ci.md")) {
    errors.push(`${directory}: outer loop must load the product-CI procedure`);
  }
  if (!content.includes("native watch hook")) {
    errors.push(`${directory}: outer loop must prefer native watch hooks for PENDING`);
  }
  if (!content.includes("only when no hook applies")) {
    errors.push(`${directory}: outer loop must make timer waiting the fallback`);
  }
  return errors;
};

/**
 * The Claude Code plugin is a generated copy with shortened stage names, because
 * Claude Code resolves a plugin skill's command from the frontmatter `name`.
 * Cursor and `npx skills` keep the canonical `terreno-<n>-<stage>` names.
 */
export const validateClaudePluginHost = ({
  rootDirectory,
}: ValidateLifecyclePluginOptions): string[] => {
  const errors: string[] = [];
  const claudeDirectory = join(rootDirectory, "plugins/terreno-claude");
  const claudeManifest = JSON.parse(
    readFileSync(join(claudeDirectory, ".claude-plugin/plugin.json"), "utf8")
  ) as {
    agents?: string[];
    description?: string;
    name?: string;
    skills?: string;
    version?: string;
  };
  const cursorManifest = JSON.parse(
    readFileSync(join(rootDirectory, "plugins/terreno-planning/.cursor-plugin/plugin.json"), "utf8")
  ) as {description?: string; version?: string};
  const claudeMarketplace = JSON.parse(
    readFileSync(join(rootDirectory, ".claude-plugin/marketplace.json"), "utf8")
  ) as {name?: string; plugins?: Array<{name?: string; source?: string}>};

  if (claudeManifest.name !== "terreno") {
    errors.push("Claude plugin name must be terreno so stages resolve as /terreno:<stage>");
  }
  if (claudeManifest.version !== cursorManifest.version) {
    errors.push("Claude and Cursor plugin versions must match");
  }
  if (claudeManifest.description !== cursorManifest.description) {
    errors.push("Claude and Cursor plugin descriptions must match");
  }
  if (claudeManifest.skills !== "./skills/") {
    errors.push("Claude plugin skills path must be ./skills/");
  }
  const expectedClaudeAgents = [...PLUGIN_AGENT_NAMES]
    .sort()
    .map((agentName) => `./agents/${agentName}.md`);
  if (JSON.stringify(claudeManifest.agents) !== JSON.stringify(expectedClaudeAgents)) {
    errors.push(`Claude plugin agents must be exactly ${expectedClaudeAgents.join(", ")}`);
  }

  if (!claudeMarketplace.name || claudeMarketplace.name === claudeManifest.name) {
    errors.push(
      "Claude marketplace name must differ from plugin name terreno (Claude Code cache collision)"
    );
  }

  const [claudeEntry] = claudeMarketplace.plugins ?? [];
  if (claudeEntry?.name !== "terreno") {
    errors.push("Claude marketplace must publish the plugin as terreno");
  }
  if (claudeEntry?.source !== "./plugins/terreno-claude") {
    errors.push("Claude marketplace source must be ./plugins/terreno-claude");
  }

  const claudeStages = readdirSync(join(claudeDirectory, "skills"), {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedClaudeStages = [
    ...STAGE_DEFINITIONS.map(({directory}) => directory.replace(/^terreno-/, "")),
    ...OUTER_LOOP_DIRECTORIES.map((directory) => directory.replace(/^terreno-/, "")),
    ...PLUGIN_APP_SKILL_DIRECTORIES,
  ].sort();
  if (JSON.stringify(claudeStages) !== JSON.stringify(expectedClaudeStages)) {
    errors.push(
      `Claude plugin stages must be exactly ${expectedClaudeStages.join(", ")}; found ${claudeStages.join(", ")}`
    );
  }

  for (const stageDirectory of claudeStages) {
    const content = readFileSync(
      join(claudeDirectory, "skills", stageDirectory, "SKILL.md"),
      "utf8"
    );
    if (!content.includes(`name: ${stageDirectory}`)) {
      errors.push(`Claude stage ${stageDirectory} frontmatter name must be ${stageDirectory}`);
    }
  }

  const claudeContinuousLoop = readFileSync(
    join(claudeDirectory, "skills/pick-roast-loop/SKILL.md"),
    "utf8"
  );
  if (!claudeContinuousLoop.includes("genuine human decision")) {
    errors.push("Claude pick-roast-loop must preserve the genuine human gate");
  }

  const claudeAgents = readdirSync(join(claudeDirectory, "agents"), {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
  if (JSON.stringify(claudeAgents) !== JSON.stringify([...PLUGIN_AGENT_NAMES].sort())) {
    errors.push(
      `Claude plugin agents must be exactly ${PLUGIN_AGENT_NAMES.join(", ")}; found ${claudeAgents.join(", ")}`
    );
  }

  const claudePick = readFileSync(join(claudeDirectory, "skills/2-pick/SKILL.md"), "utf8");
  const claudeRoast = readFileSync(join(claudeDirectory, "skills/3-roast/SKILL.md"), "utf8");
  const claudePickRoastLoop = readFileSync(
    join(claudeDirectory, "references/pick-roast-loop.md"),
    "utf8"
  );
  for (const [label, content] of [
    ["Claude 2-pick", claudePick],
    ["Claude 3-roast", claudeRoast],
  ] as const) {
    if (!content.includes("../../references/pick-roast-loop.md")) {
      errors.push(`${label} must load the pick-roast inner loop`);
    }
    if (!content.includes("Do not start the next task until Roast PASS")) {
      errors.push(`${label} must require Roast PASS before the next task`);
    }
    if (!content.includes("Roast never invokes Pick")) {
      errors.push(`${label} must treat Roast as prove-only`);
    }
  }
  if (!claudePick.includes("repeat from Reconstruct")) {
    errors.push("Claude 2-pick must rediscover docs and skills on the next task");
  }
  if (!claudeRoast.includes("Pick owns the inner loop")) {
    errors.push("Claude 3-roast must name Pick as the inner-loop driver");
  }
  if (!claudePickRoastLoop.includes("Roast never invokes Pick")) {
    errors.push("Claude pick-roast loop must forbid Roast from invoking Pick");
  }

  return errors;
};

/**
 * Codex installs the canonical plugin: `.codex-plugin/plugin.json` plus a repo
 * marketplace at `.agents/plugins/marketplace.json`. Stage names stay
 * `terreno-<n>-<stage>` (`$terreno-1-grow`).
 */
export const validateCodexPluginHost = ({
  rootDirectory,
}: ValidateLifecyclePluginOptions): string[] => {
  const errors: string[] = [];
  const pluginDirectory = join(rootDirectory, "plugins/terreno-planning");
  const cursorManifest = JSON.parse(
    readFileSync(join(pluginDirectory, ".cursor-plugin/plugin.json"), "utf8")
  ) as {description?: string; name?: string; version?: string};
  const codexManifest = JSON.parse(
    readFileSync(join(pluginDirectory, ".codex-plugin/plugin.json"), "utf8")
  ) as {description?: string; name?: string; skills?: string; version?: string};
  const codexMarketplace = JSON.parse(
    readFileSync(join(rootDirectory, ".agents/plugins/marketplace.json"), "utf8")
  ) as {
    name?: string;
    plugins?: Array<{
      category?: string;
      name?: string;
      policy?: {authentication?: string; installation?: string};
      source?: {path?: string; source?: string};
    }>;
  };

  if (codexManifest.name !== "terreno-planning") {
    errors.push("Codex plugin name must be terreno-planning");
  }
  if (codexManifest.version !== cursorManifest.version) {
    errors.push("Codex and Cursor plugin versions must match");
  }
  if (codexManifest.description !== cursorManifest.description) {
    errors.push("Codex and Cursor plugin descriptions must match");
  }
  if (codexManifest.skills !== "./skills/") {
    errors.push("Codex plugin skills path must be ./skills/");
  }
  if (codexMarketplace.name !== "terreno-plugins") {
    errors.push("Codex marketplace name must be terreno-plugins");
  }

  const [codexEntry] = codexMarketplace.plugins ?? [];
  if (codexEntry?.name !== "terreno-planning") {
    errors.push("Codex marketplace must publish the plugin as terreno-planning");
  }
  if (codexEntry?.source?.source !== "local") {
    errors.push("Codex marketplace source.source must be local");
  }
  if (codexEntry?.source?.path !== "./plugins/terreno-planning") {
    errors.push("Codex marketplace source.path must be ./plugins/terreno-planning");
  }
  if (codexEntry?.policy?.installation !== "AVAILABLE") {
    errors.push("Codex marketplace policy.installation must be AVAILABLE");
  }
  if (codexEntry?.policy?.authentication !== "ON_INSTALL") {
    errors.push("Codex marketplace policy.authentication must be ON_INSTALL");
  }
  if (codexEntry?.category !== "Development & Workflow") {
    errors.push("Codex marketplace category must be Development & Workflow");
  }

  return errors;
};

export const validateLifecyclePlugin = ({
  rootDirectory,
}: ValidateLifecyclePluginOptions): string[] => {
  const errors: string[] = [];
  const pluginDirectory = join(rootDirectory, "plugins/terreno-planning");
  const skillsDirectory = join(rootDirectory, "plugins/terreno-planning/skills");
  const pluginManifest = JSON.parse(
    readFileSync(join(pluginDirectory, ".cursor-plugin/plugin.json"), "utf8")
  ) as {agents?: string[]};
  if (JSON.stringify(pluginManifest.agents) !== JSON.stringify(["agents"])) {
    errors.push("Cursor plugin agents path must be agents");
  }

  for (const directory of PLUGIN_APP_SKILL_DIRECTORIES) {
    if (!existsSync(join(skillsDirectory, directory, "SKILL.md"))) {
      errors.push(`plugin Terreno app skill is missing: ${directory}`);
    }
  }
  for (const directory of REMOVED_SKILL_DIRECTORIES) {
    if (
      existsSync(join(rootDirectory, ".rulesync/skills", directory)) ||
      existsSync(join(skillsDirectory, directory)) ||
      existsSync(join(rootDirectory, "skills", directory))
    ) {
      errors.push(`removed skill still exists: ${directory}`);
    }
  }
  const skillsLock = JSON.parse(readFileSync(join(rootDirectory, "skills-lock.json"), "utf8")) as {
    skills?: Record<string, unknown>;
  };
  for (const directory of REMOVED_SKILL_DIRECTORIES) {
    if (directory in (skillsLock.skills ?? {})) {
      errors.push(`removed skill still exists in skills-lock.json: ${directory}`);
    }
  }

  const pluginAgents = readdirSync(join(pluginDirectory, "agents"), {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
  if (JSON.stringify(pluginAgents) !== JSON.stringify([...PLUGIN_AGENT_NAMES].sort())) {
    errors.push(
      `plugin agents must be exactly ${PLUGIN_AGENT_NAMES.join(", ")}; found ${pluginAgents.join(", ")}`
    );
  }
  for (const agentName of PLUGIN_AGENT_NAMES) {
    if (existsSync(join(rootDirectory, ".rulesync/subagents", `${agentName}.md`))) {
      errors.push(`plugin agent still duplicated in rulesync: ${agentName}`);
    }
  }

  const actualStageDirectories = readdirSync(skillsDirectory, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && /^terreno-\d-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const expectedStageDirectories = STAGE_DEFINITIONS.map(({directory}) => directory).sort();

  if (JSON.stringify(actualStageDirectories) !== JSON.stringify(expectedStageDirectories)) {
    errors.push(
      `plugin lifecycle directories must be exactly ${expectedStageDirectories.join(", ")}; found ${actualStageDirectories.join(", ")}`
    );
  }

  for (const directory of OUTER_LOOP_DIRECTORIES) {
    const skillPath = join(skillsDirectory, directory, "SKILL.md");
    if (!existsSync(skillPath)) {
      errors.push(`plugin outer-loop skill is missing: ${directory}`);
      continue;
    }
    const content = readFileSync(skillPath, "utf8");
    errors.push(...validateOuterLoopContent({content, directory}));
  }

  const grilling = readFileSync(
    join(skillsDirectory, "terreno-1-grow/references/grilling.md"),
    "utf8"
  );

  for (const definition of STAGE_DEFINITIONS) {
    const skillPath = join(skillsDirectory, definition.directory, "SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    errors.push(
      ...validateStageContent({
        content,
        definition,
        grillingContent: definition.stage === "grow" ? grilling : undefined,
      })
    );
    if (content.includes("Cupping")) {
      errors.push(`${definition.directory}: Cupping terminology must be migrated to Roast`);
    }
  }

  for (const {content, path} of readMarkdownFiles(join(pluginDirectory, "references"))) {
    for (const marker of PORTABILITY_MARKERS) {
      if (content.includes(marker)) {
        errors.push(`portable plugin reference ${path} contains repository marker ${marker}`);
      }
    }
  }

  const attentionContract = readFileSync(
    join(pluginDirectory, "references/github-attention-contract.md"),
    "utf8"
  );
  errors.push(...validateGithubAttentionContract(attentionContract));

  const documentationContract = readFileSync(
    join(pluginDirectory, "references/documentation-contract.md"),
    "utf8"
  );
  errors.push(...validateDocumentationContract(documentationContract));

  const productCi = readFileSync(join(pluginDirectory, "references/product-ci.md"), "utf8");
  errors.push(...validateProductCiContract(productCi));

  const asyncReviewBots = readFileSync(
    join(pluginDirectory, "references/async-review-bots.md"),
    "utf8"
  );
  errors.push(...validateAsyncReviewBotsContract(asyncReviewBots));

  const prDeployments = readFileSync(join(pluginDirectory, "references/pr-deployments.md"), "utf8");
  errors.push(...validatePrDeploymentsContract(prDeployments));

  const pluginReadme = readFileSync(join(rootDirectory, "plugins/README.md"), "utf8");
  if (!pluginReadme.includes("documentation-contract.md")) {
    errors.push("plugins/README.md must document the documentation contract");
  }
  if (!pluginReadme.includes("npx skills add TerrenoLabs/terreno")) {
    errors.push("plugins/README.md must document npx skills installation");
  }
  if (!pluginReadme.includes("product-ci.md")) {
    errors.push("plugins/README.md must document the product-CI procedure");
  }
  if (!pluginReadme.includes("pick-roast-loop.md")) {
    errors.push("plugins/README.md must document the pick-roast inner loop");
  }
  if (!pluginReadme.includes("subagent-briefing.md")) {
    errors.push("plugins/README.md must document the subagent briefing contract");
  }
  if (!pluginReadme.includes(".claude-plugin/marketplace.json")) {
    errors.push("plugins/README.md must document the Claude Code marketplace");
  }
  if (!pluginReadme.includes("/plugin marketplace add TerrenoLabs/terreno")) {
    errors.push("plugins/README.md must document Claude Code marketplace install");
  }
  if (!pluginReadme.includes("/plugin install terreno@terreno-plugins")) {
    errors.push("plugins/README.md must document Claude Code install as terreno@terreno-plugins");
  }
  if (!pluginReadme.includes(".agents/plugins/marketplace.json")) {
    errors.push("plugins/README.md must document the Codex marketplace");
  }
  if (!pluginReadme.includes("codex plugin marketplace add TerrenoLabs/terreno")) {
    errors.push("plugins/README.md must document Codex marketplace install");
  }
  if (!pluginReadme.includes("codex plugin install terreno-planning --source terreno-plugins")) {
    errors.push("plugins/README.md must document Codex install as terreno-planning");
  }

  const pullRequestTemplate = readFileSync(
    join(rootDirectory, ".github/PULL_REQUEST_TEMPLATE.md"),
    "utf8"
  );
  for (const heading of PR_HEADINGS) {
    if (!pullRequestTemplate.includes(heading)) {
      errors.push(`pull request template is missing required heading ${heading}`);
    }
  }
  for (const heading of PR_FORBIDDEN_HEADINGS) {
    if (pullRequestTemplate.includes(heading)) {
      errors.push(`pull request template contains retired heading ${heading}`);
    }
  }

  const pluginFiles = [
    join(pluginDirectory, ".cursor-plugin/plugin.json"),
    join(pluginDirectory, ".codex-plugin/plugin.json"),
    join(rootDirectory, ".cursor-plugin/marketplace.json"),
    join(rootDirectory, ".agents/plugins/marketplace.json"),
    join(rootDirectory, "CONTRIBUTING.md"),
  ];
  const canonicalText = pluginFiles.map((path) => readFileSync(path, "utf8")).join("\n");

  errors.push(...validateClaudePluginHost({rootDirectory}));
  errors.push(...validateCodexPluginHost({rootDirectory}));

  for (const retiredIdentifier of RETIRED_IDENTIFIERS) {
    if (canonicalText.includes(retiredIdentifier)) {
      errors.push(`active plugin metadata/docs contain retired identifier ${retiredIdentifier}`);
    }
  }

  const migrationDocumentation = readFileSync(join(rootDirectory, "plugins/README.md"), "utf8");
  for (const retiredIdentifier of RETIRED_IDENTIFIERS) {
    if (!migrationDocumentation.includes(retiredIdentifier)) {
      errors.push(`migration documentation is missing retired identifier ${retiredIdentifier}`);
    }
  }

  const resultSchema = JSON.parse(
    readFileSync(join(pluginDirectory, "references/stage-result.schema.json"), "utf8")
  ) as {
    properties?: {
      stage?: {enum?: string[]};
      status?: {enum?: string[]};
      v?: {const?: number};
    };
    required?: string[];
  };
  const schemaStages = resultSchema.properties?.stage?.enum ?? [];
  const schemaStatuses = resultSchema.properties?.status?.enum ?? [];

  if (resultSchema.properties?.v?.const !== 2) {
    errors.push("stage-result schema v must be 2");
  }
  if (
    JSON.stringify(resultSchema.required) !==
    JSON.stringify(["v", "stage", "status", "next", "action"])
  ) {
    errors.push("stage-result schema must require only v, stage, status, next, action");
  }
  if (JSON.stringify(schemaStages) !== JSON.stringify(LIFECYCLE_STAGES)) {
    errors.push("stage-result schema stage values do not match canonical lifecycle");
  }
  if (JSON.stringify(schemaStatuses) !== JSON.stringify(RESULT_STATUSES)) {
    errors.push("stage-result schema statuses must be PASS, FAIL, BLOCKED, PENDING");
  }

  const lifecycleContract = readFileSync(
    join(pluginDirectory, "references/lifecycle-contract.md"),
    "utf8"
  );
  if (!lifecycleContract.includes("<details>")) {
    errors.push("lifecycle contract must hide stage YAML behind disclosure");
  }
  if (!lifecycleContract.includes("Omit nulls and empty arrays")) {
    errors.push("lifecycle contract must omit empty stage-result keys");
  }
  if (!lifecycleContract.includes("pick-roast-loop.md")) {
    errors.push("lifecycle contract must name the pick-roast inner loop");
  }
  if (!lifecycleContract.includes("last visible section")) {
    errors.push("lifecycle contract must close wait/done chats with PR demo URLs");
  }

  const loopEngineering = readFileSync(
    join(pluginDirectory, "references/loop-engineering.md"),
    "utf8"
  );
  if (!loopEngineering.includes("pick-roast-loop.md")) {
    errors.push("loop engineering must load the pick-roast inner loop");
  }
  if (!loopEngineering.includes("Do not start the next task until Roast PASS")) {
    errors.push("loop engineering must require Roast PASS before the next task");
  }
  if (!loopEngineering.includes("Exactly one driver continues")) {
    errors.push("loop engineering must name a single inner-loop driver");
  }
  if (!loopEngineering.includes("Roast never invokes Pick")) {
    errors.push("loop engineering must forbid Roast from invoking Pick");
  }
  if (loopEngineering.includes("run independent tasks in parallel")) {
    errors.push("loop engineering must not pick tasks in parallel without roasting each");
  }

  const pickRoastLoop = readFileSync(
    join(pluginDirectory, "references/pick-roast-loop.md"),
    "utf8"
  );
  if (!pickRoastLoop.includes("Roast never invokes Pick")) {
    errors.push("pick-roast loop must forbid Roast from invoking Pick");
  }
  if (pickRoastLoop.includes("entry Roast may invoke Pick")) {
    errors.push("pick-roast loop must not let entry Roast invoke Pick");
  }
  if (!pickRoastLoop.includes("subagent-briefing.md")) {
    errors.push("pick-roast loop must load the subagent briefing contract");
  }
  if (!pickRoastLoop.includes("## Commits and pushes")) {
    errors.push("pick-roast loop must define commit and push rules");
  }
  if (!pickRoastLoop.includes("Pick and Roast do not push")) {
    errors.push("pick-roast loop must keep pushes out of the inner loop");
  }
  if (!pickRoastLoop.includes("Do not ask Roast or its children to rediscover")) {
    errors.push("pick-roast loop must forbid Roast children from rediscovering the repo");
  }

  const executionSchema = JSON.parse(
    readFileSync(join(pluginDirectory, "references/execution-state.schema.json"), "utf8")
  ) as {
    properties?: {
      ledger?: {
        items?: {
          properties?: {stage?: {enum?: string[]}};
          required?: string[];
        };
        type?: string;
      };
      stage?: {enum?: string[]};
      v?: {const?: number};
    };
  };
  const executionStages = executionSchema.properties?.stage?.enum ?? [];
  if (executionSchema.properties?.v?.const !== 2) {
    errors.push("execution-state schema v must be 2");
  }
  if (JSON.stringify(executionStages) !== JSON.stringify(LIFECYCLE_STAGES)) {
    errors.push("execution-state schema stage values do not match canonical lifecycle");
  }
  const ledger = executionSchema.properties?.ledger;
  if (
    ledger?.type !== "array" ||
    !ledger.items?.required?.includes("ev") ||
    JSON.stringify(ledger.items?.properties?.stage?.enum) !== JSON.stringify(["pick", "roast"])
  ) {
    errors.push("execution-state schema must define the Pick-Roast run ledger");
  }

  return errors;
};
