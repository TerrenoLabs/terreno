/**
 * Generates the Claude Code plugin tree from the canonical lifecycle stages.
 *
 * Claude Code takes a plugin skill's command from the frontmatter `name`, so the
 * shortened `/terreno:1-grow` names cannot live in the shared stage files that
 * Cursor and `npx skills` consume. This emits a Claude-only copy instead.
 */
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

interface SyncClaudePluginOptions {
  check?: boolean;
  rootDirectory: string;
  target?: ClaudePluginTarget;
}

interface GeneratedFile {
  contents: string;
  path: string;
}

export const CANONICAL_PLUGIN_DIRECTORY = "plugins/terreno-planning";
export const CLAUDE_PLUGIN_DIRECTORY = "plugins/terreno-claude";
export const CLAUDE_PLUGIN_NAME = "terreno";
/** Marketplace that installs each Claude plugin from npm at its latest stable release. */
export const CLAUDE_RELEASE_MARKETPLACE_PATH =
  "plugins/claude-release/.claude-plugin/marketplace.json";
export const CLAUDE_RELEASE_MARKETPLACE_NAME = "terreno-releases";

const LONG_SKILL_NAME_PATTERN =
  /terreno-([1-5]-[a-z]+|pick-roast-loop|planning-loop|taste-sweep|prd)/g;
const LONG_SCAN_SKILL_NAME_PATTERN = /terreno-loop-([1-5]-[a-z]+|campaign|run)/g;

interface ClaudePluginTarget {
  /** Extra rewrites applied to markdown, in order, after the directory-name rewrite. */
  contentPatterns: RegExp[];
  canonicalDirectory: string;
  claudeDirectory: string;
  claudeName: string;
  displayName: string;
  namePattern: RegExp;
  /** npm package the release pipeline publishes this plugin directory as. */
  npmPackage: string;
}

export const CLAUDE_PLUGIN_TARGETS: ClaudePluginTarget[] = [
  {
    canonicalDirectory: CANONICAL_PLUGIN_DIRECTORY,
    claudeDirectory: CLAUDE_PLUGIN_DIRECTORY,
    claudeName: CLAUDE_PLUGIN_NAME,
    contentPatterns: [],
    displayName: "Terreno",
    namePattern: LONG_SKILL_NAME_PATTERN,
    npmPackage: "@terreno/agent-plugin",
  },
  {
    canonicalDirectory: "plugins/terreno-loop",
    claudeDirectory: "plugins/terreno-loop-claude",
    claudeName: "terreno-loop",
    contentPatterns: [LONG_SKILL_NAME_PATTERN],
    displayName: "Terreno Loop",
    namePattern: LONG_SCAN_SKILL_NAME_PATTERN,
    npmPackage: "@terreno/agent-plugin-loop",
  },
];

const [PLANNING_TARGET] = CLAUDE_PLUGIN_TARGETS;

const RELEASE_MARKETPLACE_URL =
  "https://raw.githubusercontent.com/TerrenoLabs/terreno/master/plugins/claude-release/.claude-plugin/marketplace.json";

const buildInstallSection = (target: ClaudePluginTarget, firstCommand: string): string =>
  `## Install

Pick one channel and register only that one. Each channel provides a plugin named
\`${target.claudeName}\`, so two channels give duplicate commands.

Latest stable release, installed from npm as \`${target.npmPackage}\`:

\`\`\`text
/plugin marketplace add ${RELEASE_MARKETPLACE_URL}
/plugin install ${target.claudeName}@${CLAUDE_RELEASE_MARKETPLACE_NAME}
\`\`\`

Every merge to \`master\`:

\`\`\`text
/plugin marketplace add TerrenoLabs/terreno
/plugin install ${target.claudeName}@terreno-plugins
\`\`\`

One release, pinned: add \`TerrenoLabs/terreno#<version>\` as the marketplace instead.

Then run \`${firstCommand}\`. Claude Code does not auto-update third-party marketplaces by
default; run \`/plugin update ${target.claudeName}@<marketplace>\` to pick up a new release.
`;

const buildMaintainerSection = (target: ClaudePluginTarget, sources: string): string =>
  `## Maintainers

This directory is generated. Do not hand-edit it; run \`bun run skills:sync\`.

Claude Code resolves a plugin skill's command from the frontmatter \`name\`, so the
shortened names live here instead of in the shared skill files. Cursor, Codex, and
\`npx skills\` keep the canonical names from \`${target.canonicalDirectory}/\`.

| Source | Owns |
| --- | --- |
${sources}
`;

const buildClaudePluginReadme = (target: ClaudePluginTarget): string =>
  `# Terreno plugin for Claude Code

Terreno's agent lifecycle and app-building skills for Claude Code. Grow shapes a request
into an approved plan, Pick and Roast build and prove it one task at a time, Brew opens the
pull request, and Taste reacts to review and CI until it is mergeable. The plugin also ships
Terreno backend, UI, data, admin, docs, upgrade, and deployment skills, plus the
\`pre-commit\` and \`ui-verifier\` agents.

Reference: https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/lifecycle-plugin.md

${buildInstallSection(target, "/terreno:1-grow")}
## What you get

| Command | Does |
| --- | --- |
| \`/terreno:1-grow\` | Research, clarify, and approve an implementation plan and task list |
| \`/terreno:2-pick\` | Build one task test-first, then roast it and pick the next |
| \`/terreno:3-roast\` | Independently prove or disprove the current task |
| \`/terreno:4-brew\` | Final checks, commit, push, open the PR, wait for CI and review bots |
| \`/terreno:5-taste\` | React to CI and review on the PR until it is mergeable |
| \`/terreno:pick-roast-loop\` | Work an approved plan through every task |

${buildMaintainerSection(
  target,
  `| \`${target.canonicalDirectory}/skills/\` | Lifecycle and Terreno app workflows |
| \`${target.canonicalDirectory}/agents/\` | Reusable verification agents |
| \`${target.canonicalDirectory}/references/\` | Shared lifecycle references |`
)}`;

const buildScanPluginReadme = (target: ClaudePluginTarget): string =>
  `# Terreno Loop plugin for Claude Code

Goal-driven loops for Claude Code. Give it an outcome an agent can measure on its own,
such as CI wall time, bundle size, or lint count, and it charters the goal, finds the work,
slices it into pull requests, and re-measures after each one lands until the metric hits
target or the budget runs out. Each slice goes through the \`terreno\` lifecycle plugin, so
install that plugin too.

Reference: https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/scan-plugin.md

${buildInstallSection(target, "/terreno-loop:run <goal>")}
## What you get

| Command | Does |
| --- | --- |
| \`/terreno-loop:1-aim\` | Charter the goal: metric, baseline, rules, budget |
| \`/terreno-loop:2-sweep\` | Run the rules and map parallel workers into candidate findings |
| \`/terreno-loop:3-sift\` | Dedupe, verify, and rank findings |
| \`/terreno-loop:4-plot\` | Slice findings into PR-sized plans |
| \`/terreno-loop:5-track\` | Re-measure the metric and choose the next move |
| \`/terreno-loop:campaign\` | Run bounded rounds, stopping at each gate |
| \`/terreno-loop:run\` | Stay resident: keep the goal moving and tend every open PR |

Loops can run for hours and use many tokens. Set a budget or stop condition in the charter.

${buildMaintainerSection(
  target,
  `| \`${target.canonicalDirectory}/skills/\` | Aim, Sweep, Sift, Plot, Track, and the outer loops |
| \`${target.canonicalDirectory}/references/\` | Scan contract, map-reduce, goal tracking, schemas |`
)}`;

const buildReadme = (target: ClaudePluginTarget): string =>
  target.claudeName === CLAUDE_PLUGIN_NAME
    ? buildClaudePluginReadme(target)
    : buildScanPluginReadme(target);

export const shortenStageName = (stageName: string): string =>
  stageName.replace(LONG_SKILL_NAME_PATTERN, "$1");

export const rewriteStageNames = (contents: string): string =>
  contents.replace(LONG_SKILL_NAME_PATTERN, "$1");

const shortenTargetName = (stageName: string, target: ClaudePluginTarget): string =>
  stageName.replace(target.namePattern, "$1");

const rewriteTargetNames = (contents: string, target: ClaudePluginTarget): string =>
  [target.namePattern, ...target.contentPatterns].reduce(
    (rewritten, pattern) => rewritten.replace(pattern, "$1"),
    contents
  );

/** Every canonical plugin skill; lifecycle names are shortened for Claude commands. */
const listSkillDirectories = (skillsDirectory: string): string[] =>
  readdirSync(skillsDirectory, {withFileTypes: true})
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(skillsDirectory, entry.name, "SKILL.md"))
    )
    .map((entry) => entry.name)
    .sort();

const listFilesRecursively = (directory: string, prefix = ""): string[] => {
  const files: string[] = [];
  if (!existsSync(directory)) {
    return files;
  }
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(join(directory, entry.name), relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

/** Claude Code requires explicit agent file paths; a directory path fails validation. */
const listAgentPaths = (rootDirectory: string, target: ClaudePluginTarget): string[] =>
  listFilesRecursively(join(rootDirectory, target.canonicalDirectory, "agents"))
    .filter((relativePath) => relativePath.endsWith(".md"))
    .map((relativePath) => `./agents/${relativePath}`);

interface CursorManifest {
  author: {email: string; name: string};
  compatibility: Record<string, string>;
  description: string;
  keywords: string[];
}

const readCursorManifest = (rootDirectory: string, target: ClaudePluginTarget): CursorManifest =>
  JSON.parse(
    readFileSync(
      join(rootDirectory, target.canonicalDirectory, ".cursor-plugin/plugin.json"),
      "utf8"
    )
  ) as CursorManifest;

/**
 * The manifest carries no `version`: Claude Code then versions a git-hosted plugin by
 * commit SHA, so master and tag installs pick up every change. The release pipeline
 * writes the release version into the npm copy (scripts/ci/prepare-package-publish.mjs).
 */
const buildClaudeManifest = (rootDirectory: string, target: ClaudePluginTarget): string => {
  const cursorManifest = readCursorManifest(rootDirectory, target);
  const agents = listAgentPaths(rootDirectory, target);

  const manifest = {
    ...(agents.length > 0 ? {agents} : {}),
    author: cursorManifest.author,
    description: cursorManifest.description,
    displayName: target.displayName,
    homepage: "https://github.com/TerrenoLabs/terreno/blob/master/plugins/README.md",
    keywords: cursorManifest.keywords,
    license: "MIT",
    metadata: {compatibility: cursorManifest.compatibility},
    name: target.claudeName,
    repository: "https://github.com/TerrenoLabs/terreno",
    skills: "./skills/",
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
};

/** npm package metadata; the release pipeline sets `version` at publish time. */
const buildPackageJson = (rootDirectory: string, target: ClaudePluginTarget): string => {
  const cursorManifest = readCursorManifest(rootDirectory, target);
  const hasAgents = listAgentPaths(rootDirectory, target).length > 0;
  const packageJson = {
    description: cursorManifest.description,
    files: [
      ".claude-plugin/",
      ...(hasAgents ? ["agents/"] : []),
      "references/",
      "skills/",
      "CHANGELOG.md",
      "LICENSE",
      "README.md",
    ],
    homepage: "https://github.com/TerrenoLabs/terreno/blob/master/plugins/README.md",
    keywords: ["claude-code", "claude-plugin", ...cursorManifest.keywords],
    license: "MIT",
    name: target.npmPackage,
    publishConfig: {access: "public"},
    repository: {
      directory: target.claudeDirectory,
      type: "git",
      url: "git+https://github.com/TerrenoLabs/terreno.git",
    },
    version: "0.0.0",
  };

  return `${JSON.stringify(packageJson, null, 2)}\n`;
};

/**
 * Release channel: each plugin comes from npm, so users get the latest stable release
 * instead of master. Users add it by URL because a repository holds one default marketplace.
 */
export const buildReleaseMarketplace = (rootDirectory: string): string => {
  const defaultMarketplace = JSON.parse(
    readFileSync(join(rootDirectory, ".claude-plugin/marketplace.json"), "utf8")
  ) as {
    owner: {email: string; name: string};
    plugins: {description: string; name: string; source: string}[];
  };
  const plugins = CLAUDE_PLUGIN_TARGETS.map((target) => {
    const entry = defaultMarketplace.plugins.find(({name}) => name === target.claudeName);
    if (!entry) {
      throw new Error(`.claude-plugin/marketplace.json has no ${target.claudeName} entry`);
    }
    return {
      description: entry.description,
      name: target.claudeName,
      source: {package: target.npmPackage, source: "npm"},
    };
  });
  const marketplace = {
    description:
      "Terreno plugins at the latest stable release, installed from npm. For master, add TerrenoLabs/terreno instead.",
    name: CLAUDE_RELEASE_MARKETPLACE_NAME,
    owner: defaultMarketplace.owner,
    plugins,
  };

  return `${JSON.stringify(marketplace, null, 2)}\n`;
};

const syncReleaseMarketplace = ({
  check = false,
  rootDirectory,
}: SyncClaudePluginOptions): string[] => {
  const path = join(rootDirectory, CLAUDE_RELEASE_MARKETPLACE_PATH);
  const contents = buildReleaseMarketplace(rootDirectory);
  if (!check) {
    mkdirSync(join(path, ".."), {recursive: true});
    writeFileSync(path, contents);
    return [];
  }
  if (!existsSync(path) || readFileSync(path, "utf8") !== contents) {
    return [`Claude release marketplace drift in ${CLAUDE_RELEASE_MARKETPLACE_PATH}`];
  }
  return [];
};

export const buildClaudePluginFiles = ({
  rootDirectory,
  target = PLANNING_TARGET,
}: {
  rootDirectory: string;
  target?: ClaudePluginTarget;
}): GeneratedFile[] => {
  const canonicalDirectory = join(rootDirectory, target.canonicalDirectory);
  const canonicalSkills = join(canonicalDirectory, "skills");
  const canonicalAgents = join(canonicalDirectory, "agents");
  const canonicalReferences = join(canonicalDirectory, "references");
  const files: GeneratedFile[] = [
    {contents: buildClaudeManifest(rootDirectory, target), path: ".claude-plugin/plugin.json"},
    {contents: readFileSync(join(canonicalDirectory, "LICENSE"), "utf8"), path: "LICENSE"},
    {contents: buildReadme(target), path: "README.md"},
    {contents: buildPackageJson(rootDirectory, target), path: "package.json"},
  ];

  for (const skillName of listSkillDirectories(canonicalSkills)) {
    const shortName = shortenTargetName(skillName, target);
    for (const relativePath of listFilesRecursively(join(canonicalSkills, skillName))) {
      const contents = readFileSync(join(canonicalSkills, skillName, relativePath), "utf8");
      files.push({
        contents: relativePath.endsWith(".md") ? rewriteTargetNames(contents, target) : contents,
        path: `skills/${shortName}/${relativePath}`,
      });
    }
  }

  for (const relativePath of listFilesRecursively(canonicalAgents)) {
    files.push({
      contents: readFileSync(join(canonicalAgents, relativePath), "utf8"),
      path: `agents/${relativePath}`,
    });
  }

  for (const relativePath of listFilesRecursively(canonicalReferences)) {
    files.push({
      contents: readFileSync(join(canonicalReferences, relativePath), "utf8"),
      path: `references/${relativePath}`,
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
};

export const syncClaudePlugin = ({
  check = false,
  rootDirectory,
  target = PLANNING_TARGET,
}: SyncClaudePluginOptions): string[] => {
  const destination = join(rootDirectory, target.claudeDirectory);
  const files = buildClaudePluginFiles({rootDirectory, target});

  if (check) {
    const errors: string[] = [];
    const expected = new Set(files.map(({path}) => path));

    for (const {contents, path} of files) {
      const absolutePath = join(destination, path);
      if (!existsSync(absolutePath)) {
        errors.push(`Claude plugin missing ${target.claudeDirectory}/${path}`);
        continue;
      }
      if (readFileSync(absolutePath, "utf8") !== contents) {
        errors.push(`Claude plugin drift in ${target.claudeDirectory}/${path}`);
      }
    }

    if (existsSync(destination)) {
      for (const path of listFilesRecursively(destination)) {
        if (!expected.has(path)) {
          errors.push(`Claude plugin has extra ${target.claudeDirectory}/${path}`);
        }
      }
    }

    return errors;
  }

  rmSync(destination, {force: true, recursive: true});
  for (const {contents, path} of files) {
    const absolutePath = join(destination, path);
    mkdirSync(join(absolutePath, ".."), {recursive: true});
    writeFileSync(absolutePath, contents);
  }

  return [];
};

/** Every host plugin Claude Code installs: the lifecycle plugin and the scan plugin. */
export const syncAllClaudePlugins = ({
  check = false,
  rootDirectory,
}: SyncClaudePluginOptions): string[] => [
  ...CLAUDE_PLUGIN_TARGETS.flatMap((target) => syncClaudePlugin({check, rootDirectory, target})),
  ...syncReleaseMarketplace({check, rootDirectory}),
];

if (import.meta.main) {
  const rootDirectory = resolve(import.meta.dir, "../..");
  const check = process.argv.includes("--check");
  const errors = syncAllClaudePlugins({check, rootDirectory});
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  const directories = [
    ...CLAUDE_PLUGIN_TARGETS.map(({claudeDirectory}) => `${claudeDirectory}/`),
    CLAUDE_RELEASE_MARKETPLACE_PATH,
  ].join(", ");
  console.info(check ? `${directories} are in sync.` : `Wrote ${directories}.`);
}
