#!/usr/bin/env bun
/**
 * Validates the end-user guide so every page keeps the frontmatter and sections chat agents
 * rely on, and the index lists exactly the pages on disk. With `--uncovered <app dir>`, also
 * lists routed screens that no page names in `screens`.
 *
 * Policy: docs/user-guide/README.md (format from the planning plugin's user-guide reference).
 */
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, relative} from "node:path";

const AUDIENCES = ["user", "admin", "staff"];
const PLATFORMS = ["web", "ios", "android"];
const SECTIONS = ["## What it does", "## How to use it", "## Intended use"];
const OPTIONAL_SECTIONS = ["## Related"];
const KEBAB_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const INDEX_FILE = "README.md";
const INDEX_COLUMNS = ["Area", "Page", "Audience", "Title"];
const INDEX_LINK_PATTERN = /^\[([^\]]+)\]\(([^)]+)\)$/;
const BANNED_PHRASES = [/coming soon/i, /\bTODO\b/, /localhost/i, /testID/];
const MAX_QUESTIONS = 5;
const DEFAULT_GUIDE_PATH = "docs/user-guide";
const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

interface PageMeta {
  area: string;
  audience: string;
  path: string;
  title: string;
}

interface PageResult {
  errors: string[];
  meta?: PageMeta;
  screens: string[];
}

export interface ResolvedGuide {
  isOff: boolean;
  path: string;
}

const splitRow = (text: string): string[] =>
  text
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/** Reads the `User guide` key from the agent instructions; `none` turns the guide off. */
export const resolveUserGuide = ({repoRoot}: {repoRoot: string}): ResolvedGuide => {
  for (const name of INSTRUCTION_FILES) {
    const path = join(repoRoot, name);
    if (!existsSync(path)) {
      continue;
    }
    const lines = readFileSync(path, "utf8").split("\n");
    const start = lines.findIndex((text) => text.trim() === "## User guide conventions");
    if (start === -1) {
      continue;
    }
    for (const text of lines.slice(start + 1)) {
      if (text.startsWith("## ")) {
        break;
      }
      const cells = text.trim().startsWith("|") ? splitRow(text) : [];
      if (cells[0] !== "User guide" || !cells[1]) {
        continue;
      }
      const value = cells[1].replace(/`/g, "");
      if (/^none\b/i.test(value)) {
        return {isOff: true, path: ""};
      }
      return {isOff: false, path: value.replace(/\/$/, "")};
    }
  }
  return {isOff: false, path: DEFAULT_GUIDE_PATH};
};

const splitFrontmatter = (content: string): {body: string; frontmatter?: string} => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {body: content};
  }
  return {body: match[2], frontmatter: match[1]};
};

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");

const validateFrontmatter = ({
  area,
  data,
  path,
  repoRoot,
}: {
  area: string;
  data: Record<string, unknown>;
  path: string;
  repoRoot: string;
}): string[] => {
  const errors: string[] = [];
  for (const key of ["title", "area", "audience", "added"]) {
    if (typeof data[key] !== "string" || (data[key] as string).trim() === "") {
      errors.push(`${path}: frontmatter needs a non-empty \`${key}\``);
    }
  }
  if (typeof data.area === "string" && data.area !== area) {
    errors.push(`${path}: \`area: ${data.area}\` must match its directory \`${area}\``);
  }
  if (typeof data.audience === "string" && !AUDIENCES.includes(data.audience)) {
    errors.push(`${path}: \`audience\` must be one of ${AUDIENCES.join(", ")}`);
  }
  if (!isStringList(data.platforms) || data.platforms.length === 0) {
    errors.push(`${path}: \`platforms\` must list at least one of ${PLATFORMS.join(", ")}`);
  } else {
    for (const platform of data.platforms.filter((item) => !PLATFORMS.includes(item))) {
      errors.push(`${path}: unknown platform \`${platform}\``);
    }
  }
  if (
    !isStringList(data.questions) ||
    data.questions.length === 0 ||
    data.questions.length > MAX_QUESTIONS
  ) {
    errors.push(`${path}: \`questions\` must list 1 to ${MAX_QUESTIONS} questions`);
  } else {
    for (const question of data.questions.filter((item) => !item.trim().endsWith("?"))) {
      errors.push(`${path}: question must end with \`?\`: ${question}`);
    }
  }
  if (data.screens !== undefined) {
    if (!isStringList(data.screens)) {
      errors.push(`${path}: \`screens\` must be a list of repository paths`);
    } else {
      for (const screen of data.screens.filter((item) => !existsSync(join(repoRoot, item)))) {
        errors.push(`${path}: screen \`${screen}\` does not exist`);
      }
    }
  }
  if (data.updated !== undefined && typeof data.updated !== "string") {
    errors.push(`${path}: \`updated\` must be an IP slug`);
  }
  return errors;
};

const validateBody = ({
  body,
  path,
  title,
}: {
  body: string;
  path: string;
  title?: string;
}): string[] => {
  const errors: string[] = [];
  const lines = body.split("\n");
  const heading = lines.find((text) => text.trim() !== "");
  if (!heading?.startsWith("# ")) {
    errors.push(`${path}: the body must open with a \`# <title>\` heading`);
  } else if (title && heading.slice(2).trim() !== title.trim()) {
    errors.push(`${path}: the \`#\` heading must match \`title\``);
  }

  const sections = lines.filter((text) => text.startsWith("## ")).map((text) => text.trim());
  const required = sections.filter((section) => SECTIONS.includes(section));
  if (required.join("|") !== SECTIONS.join("|")) {
    errors.push(`${path}: sections must be ${SECTIONS.join(", ")}, once each, in that order`);
  }
  for (const section of sections) {
    if (!SECTIONS.includes(section) && !OPTIONAL_SECTIONS.includes(section)) {
      errors.push(`${path}: unexpected section \`${section}\``);
    }
  }

  const howStart = lines.findIndex((text) => text.trim() === "## How to use it");
  if (howStart !== -1) {
    const howEnd = lines.findIndex((text, index) => index > howStart && text.startsWith("## "));
    const steps = lines.slice(howStart + 1, howEnd === -1 ? undefined : howEnd);
    if (!steps.some((text) => /^1\. \S/.test(text))) {
      errors.push(`${path}: \`## How to use it\` needs numbered steps`);
    }
  }

  for (const pattern of BANNED_PHRASES) {
    if (pattern.test(body)) {
      errors.push(`${path}: page text must not contain ${pattern}`);
    }
  }
  return errors;
};

/** Validates one guide page. `area` is the page's directory name. */
export const validatePage = ({
  area,
  content,
  path,
  repoRoot,
}: {
  area: string;
  content: string;
  path: string;
  repoRoot: string;
}): PageResult => {
  const {body, frontmatter} = splitFrontmatter(content);
  if (frontmatter === undefined) {
    return {errors: [`${path}: missing \`---\` frontmatter`], screens: []};
  }

  let data: Record<string, unknown>;
  try {
    data = (Bun.YAML.parse(frontmatter) ?? {}) as Record<string, unknown>;
  } catch (error) {
    return {errors: [`${path}: frontmatter is not valid YAML: ${String(error)}`], screens: []};
  }

  const errors = [
    ...validateFrontmatter({area, data, path, repoRoot}),
    ...validateBody({body, path, title: typeof data.title === "string" ? data.title : undefined}),
  ];
  return {
    errors,
    meta: {
      area,
      audience: String(data.audience ?? ""),
      path,
      title: String(data.title ?? ""),
    },
    screens: isStringList(data.screens) ? data.screens : [],
  };
};

const listPages = (directory: string): {area: string; file: string}[] => {
  const pages: {area: string; file: string}[] = [];
  for (const area of readdirSync(directory).sort()) {
    const areaPath = join(directory, area);
    if (!statSync(areaPath).isDirectory()) {
      continue;
    }
    for (const file of readdirSync(areaPath).sort()) {
      if (file.endsWith(".md")) {
        pages.push({area, file});
      }
    }
  }
  return pages;
};

const validateIndex = ({
  displayRoot,
  indexContent,
  pagePaths,
  pages,
}: {
  displayRoot: string;
  indexContent: string;
  pagePaths: Set<string>;
  pages: PageMeta[];
}): string[] => {
  const path = `${displayRoot}/${INDEX_FILE}`;
  const lines = indexContent.split("\n");
  const headerIndex = lines.findIndex(
    (text) => text.trim().startsWith("|") && splitRow(text).join("|") === INDEX_COLUMNS.join("|")
  );
  if (headerIndex === -1) {
    return [`${path}: missing the index table \`| ${INDEX_COLUMNS.join(" | ")} |\``];
  }

  const errors: string[] = [];
  const byPath = new Map(pages.map((page) => [page.path, page]));
  const listed = new Set<string>();
  for (let index = headerIndex + 2; index < lines.length; index++) {
    if (!lines[index].trim().startsWith("|")) {
      break;
    }
    const [area, link, audience, title] = splitRow(lines[index]);
    const match = link?.match(INDEX_LINK_PATTERN);
    if (!match) {
      errors.push(`${path}:${index + 1}: the Page cell must be a link to the page`);
      continue;
    }
    const pagePath = `${displayRoot}/${match[2]}`;
    const page = byPath.get(pagePath);
    if (!page && pagePaths.has(pagePath)) {
      // The page itself failed to parse and already reported why.
      listed.add(pagePath);
      continue;
    }
    if (!page) {
      errors.push(`${path}:${index + 1}: ${match[2]} is not a guide page`);
      continue;
    }
    if (listed.has(pagePath)) {
      errors.push(`${path}:${index + 1}: ${match[2]} is listed twice`);
    }
    listed.add(pagePath);
    if (area !== page.area || audience !== page.audience || title !== page.title) {
      errors.push(
        `${path}:${index + 1}: row for ${match[2]} must match its area, audience, and title`
      );
    }
  }
  for (const page of pages.filter((item) => !listed.has(item.path))) {
    errors.push(`${path}: ${relative(displayRoot, page.path)} is missing from the index`);
  }
  return errors;
};

/** Validates every page under a guide directory and its index. */
export const validateGuideDirectory = ({
  directory,
  displayRoot,
  repoRoot,
}: {
  directory: string;
  displayRoot: string;
  repoRoot: string;
}): {errors: string[]; screens: string[]} => {
  if (!existsSync(directory)) {
    return {errors: [`${displayRoot}: user guide directory does not exist`], screens: []};
  }

  const errors: string[] = [];
  const metas: PageMeta[] = [];
  const screens: string[] = [];
  const pagePaths = new Set<string>();
  for (const {area, file} of listPages(directory)) {
    const path = `${displayRoot}/${area}/${file}`;
    pagePaths.add(path);
    if (!KEBAB_PATTERN.test(area) || !KEBAB_PATTERN.test(file.replace(/\.md$/, ""))) {
      errors.push(`${path}: area and page names must be kebab-case`);
    }
    const result = validatePage({
      area,
      content: readFileSync(join(directory, area, file), "utf8"),
      path,
      repoRoot,
    });
    errors.push(...result.errors);
    screens.push(...result.screens);
    if (result.meta) {
      metas.push(result.meta);
    }
  }

  const indexPath = join(directory, INDEX_FILE);
  if (!existsSync(indexPath)) {
    errors.push(`${displayRoot}/${INDEX_FILE}: missing the guide index`);
  } else {
    errors.push(
      ...validateIndex({
        displayRoot,
        indexContent: readFileSync(indexPath, "utf8"),
        pagePaths,
        pages: metas,
      })
    );
  }
  return {errors, screens};
};

/** Lists routed screen files under an Expo Router app directory that no page names. */
export const listUncoveredScreens = ({
  appDirectory,
  coveredScreens,
  repoRoot,
}: {
  appDirectory: string;
  coveredScreens: string[];
  repoRoot: string;
}): string[] => {
  const covered = new Set(coveredScreens);
  const uncovered: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      const isRoute =
        /\.(tsx|ts|jsx|js)$/.test(name) &&
        !/^[_+]/.test(name) &&
        !/\.test\./.test(name) &&
        !/^[A-Z]/.test(name);
      const repoPath = relative(repoRoot, path);
      if (isRoute && !covered.has(repoPath)) {
        uncovered.push(repoPath);
      }
    }
  };
  walk(appDirectory);
  return uncovered;
};

const main = (): void => {
  const repoRoot = join(import.meta.dir, "..", "..");
  const args = process.argv.slice(2);
  const uncoveredIndex = args.indexOf("--uncovered");
  const appDirectory = uncoveredIndex === -1 ? undefined : args[uncoveredIndex + 1];
  const guide = resolveUserGuide({repoRoot});

  if (guide.isOff) {
    console.info("check-user-guide: the user guide is off for this repository (User guide: none)");
    return;
  }

  const {errors, screens} = validateGuideDirectory({
    directory: join(repoRoot, guide.path),
    displayRoot: guide.path,
    repoRoot,
  });

  if (appDirectory) {
    const uncovered = listUncoveredScreens({
      appDirectory: join(repoRoot, appDirectory),
      coveredScreens: screens,
      repoRoot,
    });
    console.info(`check-user-guide: ${uncovered.length} screen(s) no page names:`);
    for (const screen of uncovered) {
      console.info(`  ${screen}`);
    }
  }

  if (errors.length > 0) {
    console.error(`check-user-guide: found ${errors.length} problem(s):\n`);
    for (const error of errors) {
      console.error(`  ${error}`);
    }
    console.error(`\nSee ${guide.path}/README.md for the page format.`);
    process.exit(1);
  }

  console.info(`check-user-guide: every page in ${guide.path} is well formed and indexed`);
};

if (import.meta.main) {
  main();
}
