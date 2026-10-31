import {existsSync, readdirSync, readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(WEBSITE_ROOT, "..");
const STORY_CONFIG_DIR = join(REPO_ROOT, "demo/story-config");

export interface DriftItem {
  severity: "error" | "warning";
  message: string;
}

const INTERNAL_LEAKAGE_REGEX =
  /\.cursor\/rules|\.claude\/rules|\.claude\/skills|\.cursor\/skills|flourish-terreno|flourish-backend|mcp\.terreno\.flourish\.health|a\.run\.app|\bPRO-\d+\b|\bFH-\d+\b/gi;

export const parsePublishWorkingDirectories = (yaml: string): string[] => {
  const matches = [...yaml.matchAll(/working-directory:\s*([A-Za-z0-9._-]+)/g)];
  return [...new Set(matches.map((match) => match[1]))].sort();
};

export const referencePageForPackage = (packageDir: string): string => {
  if (packageDir === "mcp-server") {
    return "docs/reference/mcp-server.md";
  }
  return `docs/reference/${packageDir}.md`;
};

export const isNonStubReadme = (contents: string): boolean => {
  const lineCount = contents.split(/\r?\n/).length;
  return lineCount >= 30 && /^## Install(ation)?\b/m.test(contents);
};

export const findInternalLeakageHits = (contents: string): string[] => {
  const hits = contents.match(INTERNAL_LEAKAGE_REGEX) ?? [];
  return [...new Set(hits.map((hit) => hit.toLowerCase()))];
};

const walkMarkdownFiles = (dir: string, collected: string[]): void => {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "implementationPlans" || entry.name === "tasks") {
        continue;
      }
      walkMarkdownFiles(fullPath, collected);
      continue;
    }
    if (entry.name.endsWith(".md")) {
      collected.push(fullPath);
    }
  }
};

const collectPublicDocPaths = (repoRoot: string): string[] => {
  const paths: string[] = [];
  for (const section of ["reference", "how-to", "tutorials", "explanation"]) {
    walkMarkdownFiles(join(repoRoot, "docs", section), paths);
  }
  const docsReadme = join(repoRoot, "docs/README.md");
  if (existsSync(docsReadme)) {
    paths.push(docsReadme);
  }
  const rootReadme = join(repoRoot, "README.md");
  if (existsSync(rootReadme)) {
    paths.push(rootReadme);
  }
  return paths;
};

export const checkPublishedPackageDocs = ({
  repoRoot,
  packageDirs,
}: {
  packageDirs: string[];
  repoRoot: string;
}): DriftItem[] => {
  const issues: DriftItem[] = [];
  for (const packageDir of packageDirs) {
    const readmePath = join(repoRoot, packageDir, "README.md");
    if (!existsSync(readmePath)) {
      issues.push({
        message: `Published package ${packageDir} is missing README.md`,
        severity: "error",
      });
    } else {
      const contents = readFileSync(readmePath, "utf8");
      if (!isNonStubReadme(contents)) {
        issues.push({
          message: `Published package ${packageDir} has a stub README.md (need ≥30 lines and an ## Install heading)`,
          severity: "error",
        });
      }
    }
    const referenceRel = referencePageForPackage(packageDir);
    if (!existsSync(join(repoRoot, referenceRel))) {
      issues.push({
        message: `Published package ${packageDir} is missing ${referenceRel}`,
        severity: "error",
      });
    }
  }
  return issues;
};

const checkInternalLeakage = ({
  filePaths,
  repoRoot,
}: {
  filePaths: string[];
  repoRoot: string;
}): DriftItem[] => {
  const issues: DriftItem[] = [];
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) {
      continue;
    }
    const hits = findInternalLeakageHits(readFileSync(filePath, "utf8"));
    if (hits.length === 0) {
      continue;
    }
    const relative = filePath.startsWith(repoRoot) ? filePath.slice(repoRoot.length + 1) : filePath;
    issues.push({
      message: `Internal leakage in ${relative}: ${hits.join(", ")}`,
      severity: "error",
    });
  }
  return issues;
};

const readMultilineString = (block: string, field: string): string | undefined => {
  const inline = block.match(new RegExp(`${field}:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (inline) {
    return inline[1].replace(/\\"/g, '"');
  }
  const multiline = block.match(new RegExp(`${field}:\\s*\\n\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return multiline?.[1]?.replace(/\\"/g, '"');
};

const parseStoryConfigs = (): {name: string; interfaceName: string}[] =>
  readdirSync(STORY_CONFIG_DIR)
    .filter((file) => file.endsWith(".config.tsx"))
    .map((file) => {
      const source = readFileSync(join(STORY_CONFIG_DIR, file), "utf8");
      const blockMatch = source.match(
        /export const \w+Configuration: DemoConfiguration = \{([\s\S]*?)\n\};/
      );
      if (!blockMatch) {
        return undefined;
      }
      const block = blockMatch[1];
      const name = readMultilineString(block, "name");
      const interfaceName = block.match(/interfaceName:\s*"([^"]+)"/)?.[1];
      if (!name || !interfaceName) {
        return undefined;
      }
      return {interfaceName, name};
    })
    .filter((entry): entry is {name: string; interfaceName: string} => Boolean(entry));

const runDocsAudit = (repoRoot = REPO_ROOT): DriftItem[] => {
  const issues: DriftItem[] = [];
  const typesPath = join(repoRoot, "demo/ui-types-documentation.json");
  if (!existsSync(typesPath)) {
    issues.push({
      message: `Missing ${typesPath}. Run cd ui && bun run types.`,
      severity: "error",
    });
  }

  const typedoc = existsSync(typesPath)
    ? (JSON.parse(readFileSync(typesPath, "utf8")) as {
        children?: {children?: {name: string; children?: unknown[]}[]}[];
      })
    : undefined;

  const interfaces = new Map(
    (typedoc?.children?.flatMap((module) => module.children ?? []) ?? []).map((node) => [
      node.name,
      node.children?.length ?? 0,
    ])
  );

  const storyConfigDir = join(repoRoot, "demo/story-config");
  if (existsSync(storyConfigDir)) {
    for (const entry of parseStoryConfigs()) {
      const storyFile = join(
        repoRoot,
        `demo/stories/${entry.name.replace(/\s+/g, "")}.stories.tsx`
      );
      if (!existsSync(storyFile)) {
        issues.push({
          message: `Component "${entry.name}" is missing a demo story at demo/stories/${entry.name.replace(/\s+/g, "")}.stories.tsx`,
          severity: "warning",
        });
      }

      const propCount = interfaces.get(entry.interfaceName) ?? 0;
      if (propCount === 0) {
        issues.push({
          message: `Interface ${entry.interfaceName} (${entry.name}) has no TypeDoc props extracted.`,
          severity: "warning",
        });
      }
    }
  }

  const publishYamlPath = join(repoRoot, ".github/workflows/publish-on-tag.yml");
  const packageDirs = existsSync(publishYamlPath)
    ? parsePublishWorkingDirectories(readFileSync(publishYamlPath, "utf8"))
    : [];
  issues.push(...checkPublishedPackageDocs({packageDirs, repoRoot}));

  const leakageFiles = collectPublicDocPaths(repoRoot);
  for (const packageDir of packageDirs) {
    leakageFiles.push(join(repoRoot, packageDir, "README.md"));
  }
  leakageFiles.push(join(repoRoot, "demo/README.md"), join(repoRoot, "website/README.md"));
  issues.push(...checkInternalLeakage({filePaths: leakageFiles, repoRoot}));

  return issues;
};

const main = (): void => {
  const issues = runDocsAudit();
  if (issues.length === 0) {
    console.info("Docs audit passed — no drift detected.");
    return;
  }

  console.error("Docs audit found issues:\n");
  for (const issue of issues) {
    console.error(`[${issue.severity}] ${issue.message}`);
  }
  const hasErrors = issues.some((issue) => issue.severity === "error");
  process.exit(hasErrors ? 1 : 0);
};

if (import.meta.main) {
  main();
}
