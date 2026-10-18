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

const LONG_SKILL_NAME_PATTERN =
  /terreno-([1-5]-[a-z]+|pick-roast-loop|planning-loop|taste-sweep|prd)/g;
const LONG_SCAN_SKILL_NAME_PATTERN = /terreno-scan-([1-5]-[a-z]+|campaign|loop)/g;

interface ClaudePluginTarget {
  /** Extra rewrites applied to markdown, in order, after the directory-name rewrite. */
  contentPatterns: RegExp[];
  canonicalDirectory: string;
  claudeDirectory: string;
  claudeName: string;
  displayName: string;
  namePattern: RegExp;
}

export const CLAUDE_PLUGIN_TARGETS: ClaudePluginTarget[] = [
  {
    canonicalDirectory: CANONICAL_PLUGIN_DIRECTORY,
    claudeDirectory: CLAUDE_PLUGIN_DIRECTORY,
    claudeName: CLAUDE_PLUGIN_NAME,
    contentPatterns: [],
    displayName: "Terreno",
    namePattern: LONG_SKILL_NAME_PATTERN,
  },
  {
    canonicalDirectory: "plugins/terreno-scan",
    claudeDirectory: "plugins/terreno-scan-claude",
    claudeName: "terreno-scan",
    contentPatterns: [LONG_SKILL_NAME_PATTERN],
    displayName: "Terreno Scan",
    namePattern: LONG_SCAN_SKILL_NAME_PATTERN,
  },
];

const [PLANNING_TARGET] = CLAUDE_PLUGIN_TARGETS;

const buildClaudePluginReadme = ({canonicalDirectory}: ClaudePluginTarget): string =>
  `# Terreno Claude Code plugin

Generated. Do not hand-edit. Run \`bun run skills:sync\`.

Claude Code resolves a plugin skill's command from the frontmatter \`name\`, so the
shortened stage names live here instead of in the shared stage files. This plugin is
named \`terreno\`, so Grow is \`/terreno:1-grow\`.

| Source | Owns |
| --- | --- |
| \`${canonicalDirectory}/skills/\` | Lifecycle and Terreno app workflows |
| \`${canonicalDirectory}/agents/\` | Reusable verification agents |
| \`${canonicalDirectory}/references/\` | Shared lifecycle references |

Cursor and \`npx skills\` keep the canonical \`terreno-*\` names.
`;

const buildScanPluginReadme = ({canonicalDirectory}: ClaudePluginTarget): string =>
  `# Terreno Scan Claude Code plugin

Generated. Do not hand-edit. Run \`bun run skills:sync\`.

Claude Code resolves a plugin skill's command from the frontmatter \`name\`, so the
shortened scan-stage names live here instead of in the shared stage files. This plugin is
named \`terreno-scan\`, so Aim is \`/terreno-scan:1-aim\`.

| Source | Owns |
| --- | --- |
| \`${canonicalDirectory}/skills/\` | Aim, Sweep, Sift, Plot, Track, and the campaign loop |
| \`${canonicalDirectory}/references/\` | Scan contract, map-reduce, goal tracking, schemas |

Requires the \`terreno\` lifecycle plugin: Plot hands each slice to Grow, Pick, Roast,
Brew, and Taste. Cursor and \`npx skills\` keep the canonical \`terreno-scan-*\` names.
`;

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

const buildClaudeManifest = (rootDirectory: string, target: ClaudePluginTarget): string => {
  const cursorManifest = JSON.parse(
    readFileSync(
      join(rootDirectory, target.canonicalDirectory, ".cursor-plugin/plugin.json"),
      "utf8"
    )
  ) as {
    author: {email: string; name: string};
    compatibility: Record<string, string>;
    description: string;
    keywords: string[];
    version: string;
  };
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
    version: cursorManifest.version,
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
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
}: SyncClaudePluginOptions): string[] =>
  CLAUDE_PLUGIN_TARGETS.flatMap((target) => syncClaudePlugin({check, rootDirectory, target}));

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
  const directories = CLAUDE_PLUGIN_TARGETS.map(({claudeDirectory}) => `${claudeDirectory}/`).join(
    ", "
  );
  console.info(check ? `${directories} are in sync.` : `Wrote ${directories}.`);
}
