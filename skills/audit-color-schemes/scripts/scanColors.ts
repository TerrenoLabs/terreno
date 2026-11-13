// Static sweep for colors that do not follow the light/dark theme.
//
// Usage (from the app root):
//   bun <skill>/scripts/scanColors.ts [--json out.json] [--ignore <substring>]... <dir>...
//
// Reports every fixed color literal (hex, rgb/rgba, hsl/hsla, named colors), every
// `theme.primitives.*` read (primitives are identical in both modes), React Native
// `useColorScheme` / `Appearance` reads that bypass `useTheme().colorScheme`, hardcoded
// StatusBar styles, and TerrenoProvider mounts that never reach dark mode.

import {readdirSync, readFileSync, statSync} from "node:fs";
import {extname, join, relative} from "node:path";
import {NAMED_COLOR_NAMES} from "./color";

export type FindingKind =
  | "fixed-color"
  | "primitive"
  | "raw-color-scheme"
  | "status-bar"
  | "provider-light-only"
  | "implicit-default-color";

export interface ColorFinding {
  file: string;
  kind: FindingKind;
  line: number;
  /** Style or prop name the value is assigned to, when it can be read from the line. */
  prop?: string;
  snippet: string;
  value: string;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  ".expo",
  "coverage",
  "ios",
  "android",
  "__snapshots__",
]);
const DEFAULT_IGNORES = [
  ".test.",
  ".spec.",
  "/e2e/",
  "store/apiSdk.ts",
  "store/syncDbSdk.ts",
  ".stories.",
];

const HEX = /["'`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})["'`]/g;
const FUNCTIONAL = /(?:rgba?|hsla?)\([^)]*\)/g;
const NAMED = new RegExp(
  `(\\w+)\\s*[:=]\\s*\\{?\\s*["'\`](${NAMED_COLOR_NAMES.join("|")})["'\`]`,
  "gi"
);
const PRIMITIVE = /theme\.primitives\.(\w+)/g;
const PROP_BEFORE = /(\w+)\s*[:=]\s*\{?\s*$/;
// React Native primitives that paint a platform default (black text, gray spinner) when no
// color is passed; that default does not follow the theme.
const DEFAULT_COLOR_COMPONENTS = ["Text", "TextInput", "ActivityIndicator", "RefreshControl", "Switch"];

const listSourceFiles = (directory: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.name.startsWith(".") && entry.name !== ".") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        listSourceFiles(path, files);
      }
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
};

const propBefore = (line: string, index: number): string | undefined =>
  PROP_BEFORE.exec(line.slice(0, index))?.[1];

const isComment = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
};

export const scanSource = ({file, source}: {file: string; source: string}): ColorFinding[] => {
  const findings: ColorFinding[] = [];
  const lines = source.split("\n");
  const importsRawScheme =
    /import\s*\{[^}]*\b(useColorScheme|Appearance)\b[^}]*\}\s*from\s*["']react-native["']/s.test(
      source
    );

  const reactNativeImports =
    /import\s*\{([^}]*)\}\s*from\s*["']react-native["']/s.exec(source)?.[1] ?? "";
  const rawComponents = DEFAULT_COLOR_COMPONENTS.filter((name) =>
    new RegExp(`(^|[\\s,])${name}([\\s,]|$)`).test(reactNativeImports)
  );
  const importsTerrenoProvider = /from\s*["']@terreno\/ui["']/.test(source);

  lines.forEach((text, index) => {
    if (isComment(text)) {
      return;
    }
    const line = index + 1;
    const snippet = text.trim().slice(0, 140);
    const push = (kind: FindingKind, value: string, prop?: string): void => {
      findings.push({file, kind, line, prop, snippet, value});
    };

    for (const match of text.matchAll(HEX)) {
      push("fixed-color", match[0].slice(1, -1), propBefore(text, match.index ?? 0));
    }
    for (const match of text.matchAll(FUNCTIONAL)) {
      push("fixed-color", match[0], propBefore(text, match.index ?? 0));
    }
    for (const match of text.matchAll(NAMED)) {
      push("fixed-color", match[2].toLowerCase(), match[1]);
    }
    for (const match of text.matchAll(PRIMITIVE)) {
      push("primitive", match[1], propBefore(text, match.index ?? 0));
    }
    if (importsRawScheme && /\b(useColorScheme\(|Appearance\.)/.test(text)) {
      push("raw-color-scheme", "react-native color scheme read");
    }
    const statusBar = /<StatusBar[^>]*\b(?:style|barStyle)=["'](dark|light|dark-content|light-content)["']/.exec(
      text
    );
    if (statusBar) {
      push("status-bar", statusBar[1]);
    }
    for (const name of rawComponents) {
      if (new RegExp(`<${name}\\b`).test(text)) {
        push("implicit-default-color", `react-native ${name}`);
      }
    }
    // React Navigation also exports a ThemeProvider; only Terreno's provider picks the scheme.
    if (/<TerrenoProvider\b/.test(text) || (importsTerrenoProvider && /<ThemeProvider\b(?![^>]*\bvalue=)/.test(text))) {
      const element = lines.slice(index, index + 6).join(" ");
      const scheme = /colorScheme=\{?["']?(\w+)/.exec(element)?.[1];
      if (!scheme || scheme === "light") {
        push("provider-light-only", scheme ?? "(default light)");
      }
    }
  });
  return findings;
};

const parseArgs = (
  argv: string[]
): {directories: string[]; ignores: string[]; jsonPath?: string} => {
  const directories: string[] = [];
  const ignores = [...DEFAULT_IGNORES];
  let jsonPath: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      jsonPath = argv[++index];
      continue;
    }
    if (arg === "--ignore") {
      ignores.push(argv[++index]);
      continue;
    }
    directories.push(arg);
  }
  return {directories, ignores, jsonPath};
};

const main = async (): Promise<void> => {
  const {directories, ignores, jsonPath} = parseArgs(Bun.argv.slice(2));
  if (directories.length === 0) {
    throw new Error("Usage: bun scanColors.ts [--json out.json] [--ignore <substring>] <dir>...");
  }
  const root = process.cwd();
  const scanned: ColorFinding[] = [];
  let reachesDark = false;
  for (const directory of directories) {
    const files = statSync(directory).isDirectory() ? listSourceFiles(directory) : [directory];
    for (const path of files) {
      const file = relative(root, path);
      if (ignores.some((ignore) => `/${file}`.includes(ignore))) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      // A setColorScheme call or a computed colorScheme prop lets users reach dark mode.
      if (/\bsetColorScheme\(|colorScheme=\{(?!\s*["'`]light["'`])/.test(source)) {
        reachesDark = true;
      }
      scanned.push(...scanSource({file, source}));
    }
  }
  const findings = reachesDark
    ? scanned.filter((finding) => finding.kind !== "provider-light-only")
    : scanned;

  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.kind] = (acc[finding.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.info("| File:line | Kind | Prop | Value |");
  console.info("| --- | --- | --- | --- |");
  for (const finding of findings) {
    console.info(
      `| ${finding.file}:${finding.line} | ${finding.kind} | ${finding.prop ?? ""} | \`${finding.value}\` |`
    );
  }
  console.info(`\n${findings.length} finding(s): ${JSON.stringify(counts)}`);
  if (jsonPath) {
    await Bun.write(jsonPath, `${JSON.stringify(findings, null, 2)}\n`);
    console.info(`JSON: ${jsonPath}`);
  }
};

if (import.meta.main) {
  await main();
}
