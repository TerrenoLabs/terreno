import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WEBSITE_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(WEBSITE_ROOT, "..");
const TYPES_PATH = join(REPO_ROOT, "demo/ui-types-documentation.json");
const STORY_CONFIG_DIR = join(REPO_ROOT, "demo/story-config");
const OUTPUT_DIR = join(REPO_ROOT, "docs/reference/components");

interface DemoConfigEntry {
  name: string;
  interfaceName: string;
  description: string;
  shortDescription?: string;
  category: string[];
}

interface TypedocProp {
  name: string;
  flags?: {isOptional?: boolean};
  comment?: {summary?: {text: string}[]};
  type?: {name?: string; type?: string};
}

interface TypedocInterface {
  name: string;
  children?: TypedocProp[];
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const escapeMdx = (value: string): string =>
  value.replace(/[<>{}]/g, (char) => `\\${char}`).replace(/\|/g, "\\|");

const parseCategories = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/"/g, ""))
      .filter(Boolean);
  }
  return [trimmed.replace(/"/g, "")];
};

const readMultilineString = (block: string, field: string): string | undefined => {
  const inline = block.match(new RegExp(`${field}:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  if (inline) {
    return inline[1].replace(/\\"/g, '"');
  }

  const multiline = block.match(new RegExp(`${field}:\\s*\\n\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return multiline?.[1]?.replace(/\\"/g, '"');
};

const parseStoryConfigFile = (filePath: string): DemoConfigEntry | undefined => {
  const source = readFileSync(filePath, "utf8");
  const blockMatch = source.match(
    /export const \w+Configuration: DemoConfiguration = \{([\s\S]*?)\n\};/
  );
  if (!blockMatch) {
    return undefined;
  }

  const block = blockMatch[1];
  const name = readMultilineString(block, "name");
  const interfaceName = block.match(/interfaceName:\s*"([^"]+)"/)?.[1];
  const description = readMultilineString(block, "description");
  const shortDescription = readMultilineString(block, "shortDescription");
  const categoryRaw = block.match(/category:\s*(\[[^\]]+\]|"[^"]+")/)?.[1];

  if (!name || !interfaceName || !description || !categoryRaw) {
    return undefined;
  }

  return {
    category: parseCategories(categoryRaw),
    description,
    interfaceName,
    name,
    shortDescription,
  };
};

const parseDemoConfigEntries = (): DemoConfigEntry[] =>
  readdirSync(STORY_CONFIG_DIR)
    .filter((file) => file.endsWith(".config.tsx"))
    .map((file) => parseStoryConfigFile(join(STORY_CONFIG_DIR, file)))
    .filter((entry): entry is DemoConfigEntry => Boolean(entry))
    .sort((a, b) => a.name.localeCompare(b.name));

const findInterface = (interfaceName: string): TypedocInterface | undefined => {
  const typedoc = JSON.parse(readFileSync(TYPES_PATH, "utf8")) as {
    children?: {children?: TypedocInterface[]}[];
  };

  return typedoc.children
    ?.flatMap((module) => module.children ?? [])
    .find((node) => node.name === interfaceName);
};

const renderPropsTable = (props: TypedocProp[] | undefined): string => {
  if (!props?.length) {
    return "_No documented props were extracted from TypeDoc._\n";
  }

  const rows = [...props]
    .sort((a, b) => {
      const aOptional = a.flags?.isOptional ?? false;
      const bOptional = b.flags?.isOptional ?? false;
      if (aOptional !== bOptional) {
        return aOptional ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((prop) => {
      const required = prop.flags?.isOptional ? "" : "Yes";
      const type = escapeMdx(prop.type?.name ?? prop.type?.type ?? "");
      const description = escapeMdx((prop.comment?.summary?.[0]?.text ?? "").replace(/\s+/g, " "));
      return `| \`${prop.name}\` | \`${type}\` | ${required} | ${description} |`;
    });

  return ["| Prop | Type | Required | Description |", "| --- | --- | --- | --- |", ...rows].join(
    "\n"
  );
};

const yamlQuote = (value: string): string => JSON.stringify(value);

const renderComponentPage = (entry: DemoConfigEntry): string => {
  const iface = findInterface(entry.interfaceName);
  const slug = slugify(entry.name);
  const storyPath = `demo/stories/${entry.name.replace(/\s+/g, "")}.stories.tsx`;
  const description = (entry.shortDescription ?? entry.description).replace(/\s+/g, " ").trim();

  return `---
title: ${yamlQuote(entry.name)}
description: ${yamlQuote(description)}
sidebar_label: ${yamlQuote(entry.name)}
slug: /reference/components/${slug}
---

import ComponentDemo from '@site/src/components/ComponentDemo';

# ${entry.name}

${escapeMdx(entry.description.replace(/\s+/g, " ").trim())}

**Package:** \`@terreno/ui\`  
**Categories:** ${entry.category.join(", ")}  
**Props interface:** \`${entry.interfaceName}\`  
**Story source:** [\`${storyPath}\`](https://github.com/TerrenoLabs/terreno/blob/master/${storyPath})

## Live demo

<ComponentDemo name="${entry.name.replace(/"/g, '\\"')}" />

## Props

${renderPropsTable(iface?.children)}
`;
};

const main = (): void => {
  if (!existsSync(TYPES_PATH)) {
    console.error(`Missing ${TYPES_PATH}. Run: cd ui && bun run types`);
    process.exit(1);
  }

  const entries = parseDemoConfigEntries();
  if (entries.length === 0) {
    console.error("No demo config entries found in demo/story-config/*.config.tsx");
    process.exit(1);
  }

  mkdirSync(OUTPUT_DIR, {recursive: true});
  for (const existing of readdirSync(OUTPUT_DIR)) {
    if (existing.endsWith(".mdx") && existing !== "README.mdx") {
      rmSync(join(OUTPUT_DIR, existing));
    }
  }

  for (const entry of entries) {
    writeFileSync(join(OUTPUT_DIR, `${slugify(entry.name)}.mdx`), renderComponentPage(entry));
  }

  const index = `---
title: UI components
description: Generated reference pages for @terreno/ui components with live demo embeds.
slug: /reference/components
---

# UI components

These pages are generated from \`demo/ui-types-documentation.json\` and \`demo/story-config/*.config.tsx\` at site build time. Each page embeds the live component demo.

${entries.map((entry) => `- [${entry.name}](./${slugify(entry.name)})`).join("\n")}
`;

  writeFileSync(join(OUTPUT_DIR, "README.mdx"), index);
  console.info(`Generated ${entries.length} component docs in ${OUTPUT_DIR}`);
};

main();
