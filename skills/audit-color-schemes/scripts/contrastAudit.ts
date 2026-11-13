// WCAG contrast audit of an app's resolved light and dark themes.
//
// Usage (from the app root, where @terreno/ui resolves):
//   bun <skill>/scripts/contrastAudit.ts [--overrides theme-overrides.json]
//     [--findings scan.json] [--json report.json]
//
// 1. Resolves the light and dark themes exactly as TerrenoProvider does: the package's
//    lightThemeConfig / darkThemeConfig, then the app's setTheme overrides (applied to BOTH
//    modes), then its primitives (setPrimitives / initialPrimitives, identical in both modes).
// 2. Checks the semantic pairs Terreno components actually render together.
// 3. With --findings (output of scanColors.ts), checks every fixed color and primitive read
//    against both modes and suggests the nearest semantic token.
//
// overrides file shape (every key optional):
//   {"primitives": {...}, "theme": {...}, "light": {...}, "dark": {...}}
// "theme" mirrors setTheme(); "light"/"dark" cover apps that call setTheme per scheme.

import {plugin} from "bun";
import {AA_LARGE_OR_UI, AA_TEXT, colorDistance, contrastRatio, formatRatio} from "./color";
import type {ColorFinding} from "./scanColors";

type Section = Record<string, string>;
type ThemeConfig = Record<string, Section | unknown>;
type ResolvedTheme = Record<string, Section>;
type Mode = "light" | "dark";

interface Overrides {
  dark?: ThemeConfig;
  light?: ThemeConfig;
  primitives?: Record<string, string>;
  theme?: ThemeConfig;
}

interface PairCheck {
  background: string;
  foreground: string;
  min: number;
  note?: string;
}

export interface AuditRow {
  dark: number | undefined;
  label: string;
  light: number | undefined;
  min: number;
  note?: string;
  status: "PASS" | "FAIL light" | "FAIL dark" | "FAIL both" | "UNPARSED";
  suggestion?: string;
}

const TEXT_ON_BASE = [
  "text.primary",
  "text.secondaryLight",
  "text.secondaryDark",
  "text.link",
  "text.accent",
  "text.error",
  "text.success",
  "text.warning",
];

/** Pairs that @terreno/ui renders together; extend with the app's own pairings. */
export const SEMANTIC_PAIRS: PairCheck[] = [
  ...TEXT_ON_BASE.flatMap((foreground) => [
    {background: "surface.base", foreground, min: AA_TEXT},
    {background: "surface.baseAlternate", foreground, min: AA_TEXT},
  ]),
  {
    background: "field.background",
    foreground: "text.extraLight",
    min: AA_TEXT,
    note: "placeholder / helper text",
  },
  {background: "field.background", foreground: "text.primary", min: AA_TEXT},
  {background: "surface.primary", foreground: "text.inverted", min: AA_TEXT, note: "primary Button"},
  {
    background: "surface.secondaryDark",
    foreground: "text.inverted",
    min: AA_TEXT,
    note: "secondary Button",
  },
  {background: "surface.error", foreground: "text.inverted", min: AA_TEXT, note: "destructive Button"},
  {background: "surface.errorLight", foreground: "text.error", min: AA_TEXT, note: "error Banner"},
  {background: "surface.successLight", foreground: "text.success", min: AA_TEXT},
  {background: "surface.warningLight", foreground: "text.warning", min: AA_TEXT},
  {background: "surface.ai", foreground: "text.primary", min: AA_TEXT},
  {background: "surface.secondaryExtraLight", foreground: "text.primary", min: AA_TEXT},
  {background: "field.background", foreground: "field.border", min: AA_LARGE_OR_UI, note: "1.4.11"},
  {background: "surface.base", foreground: "field.border", min: AA_LARGE_OR_UI, note: "1.4.11"},
  {background: "surface.base", foreground: "border.focus", min: AA_LARGE_OR_UI, note: "focus ring"},
  {background: "surface.base", foreground: "border.dark", min: AA_LARGE_OR_UI, note: "1.4.11"},
  {background: "surface.base", foreground: "border.error", min: AA_LARGE_OR_UI, note: "1.4.11"},
  {background: "surface.base", foreground: "surface.primary", min: AA_LARGE_OR_UI, note: "button edge"},
  {background: "surface.base", foreground: "status.active", min: AA_LARGE_OR_UI, note: "status dot"},
  {background: "surface.base", foreground: "status.doNotDisturb", min: AA_LARGE_OR_UI},
];

// Role is read from the prop or palette key the color is assigned to.
const TEXT_PROP = /^(color|placeholderTextColor|selectionColor)$|text|label|title|foreground|^fg$/i;
const BACKGROUND_PROP = /^(bg|underlayColor)$|background|surface|panel|fill$|^row/i;
const UI_PROPS = /border\w*Color|stroke|fill|tintColor|outlineColor|iconColor|trackColor|thumbColor/i;

const loadTerrenoTheme = async (): Promise<{
  dark: ThemeConfig;
  light: ThemeConfig;
  primitives: Record<string, string | number>;
}> => {
  // Theme.js imports react-native and the font provider; stub both so Bun can evaluate it.
  plugin({
    name: "terreno-theme-only",
    setup(build) {
      build.module("react-native", () => ({
        contents: "export const useColorScheme = () => null;",
        loader: "js",
      }));
      build.onLoad({filter: /TerrenoFontProvider\.js$/}, () => ({
        contents: "export const TerrenoFontProvider = ({children}) => children;",
        loader: "js",
      }));
    },
  });
  const themePath = Bun.resolveSync("@terreno/ui/Theme", process.cwd());
  const themeModule = (await import(themePath)) as {
    darkThemeConfig: ThemeConfig;
    defaultThemePrimitives: Record<string, string | number>;
    lightThemeConfig: ThemeConfig;
  };
  return {
    dark: themeModule.darkThemeConfig,
    light: themeModule.lightThemeConfig,
    primitives: themeModule.defaultThemePrimitives,
  };
};

const mergeSections = (base: ThemeConfig, override: ThemeConfig | undefined): ThemeConfig => {
  if (!override) {
    return base;
  }
  const merged: ThemeConfig = {...base};
  for (const [key, value] of Object.entries(override)) {
    merged[key] =
      value && typeof value === "object"
        ? {...(base[key] as Section | undefined), ...(value as Section)}
        : value;
  }
  return merged;
};

const resolveTheme = (
  config: ThemeConfig,
  primitives: Record<string, string | number>
): ResolvedTheme => {
  const resolved: ResolvedTheme = {};
  for (const [section, value] of Object.entries(config)) {
    if (section === "primitives" || section === "font" || !value || typeof value !== "object") {
      continue;
    }
    resolved[section] = {};
    for (const [token, primitive] of Object.entries(value as Section)) {
      const color = primitives[primitive];
      if (typeof color === "string") {
        resolved[section][token] = color;
      }
    }
  }
  return resolved;
};

const lookup = (theme: ResolvedTheme, path: string): string | undefined => {
  const [section, token] = path.split(".");
  return theme[section]?.[token];
};

const statusFor = (light: number | undefined, dark: number | undefined, min: number): AuditRow["status"] => {
  if (light === undefined || dark === undefined) {
    return "UNPARSED";
  }
  const lightFails = light < min;
  const darkFails = dark < min;
  if (lightFails && darkFails) {
    return "FAIL both";
  }
  if (lightFails) {
    return "FAIL light";
  }
  if (darkFails) {
    return "FAIL dark";
  }
  return "PASS";
};

const nearestToken = (
  value: string,
  theme: ResolvedTheme,
  sections: string[]
): string | undefined => {
  let best: {distance: number; path: string} | undefined;
  for (const section of sections) {
    for (const [token, color] of Object.entries(theme[section] ?? {})) {
      const distance = colorDistance(value, color);
      if (!best || distance < best.distance) {
        best = {distance, path: `${section}.${token}`};
      }
    }
  }
  if (!best || !Number.isFinite(best.distance)) {
    return undefined;
  }
  return best.distance < 8 ? `${best.path} (exact)` : `${best.path} (nearest, Δ${best.distance.toFixed(0)})`;
};

const auditFinding = ({
  finding,
  primitives,
  themes,
}: {
  finding: ColorFinding;
  primitives: Record<string, string | number>;
  themes: Record<Mode, ResolvedTheme>;
}): AuditRow | undefined => {
  if (finding.kind !== "fixed-color" && finding.kind !== "primitive") {
    return undefined;
  }
  const value = finding.kind === "primitive" ? primitives[finding.value] : finding.value;
  const label = `${finding.file}:${finding.line} \`${finding.value}\`${finding.prop ? ` (${finding.prop})` : ""}`;
  if (typeof value !== "string") {
    return {dark: undefined, label, light: undefined, min: AA_TEXT, status: "UNPARSED"};
  }
  const prop = finding.prop ?? "";
  const ratioIn = (mode: Mode, foreground: string, background: string): number | undefined =>
    contrastRatio({background, base: themes[mode].surface.base, foreground});

  if (BACKGROUND_PROP.test(prop) && !/^fill$/i.test(prop)) {
    // A fixed fill keeps its color while the default text flips: the classic dark-mode break.
    const light = ratioIn("light", themes.light.text.primary, value);
    const dark = ratioIn("dark", themes.dark.text.primary, value);
    return {
      dark,
      label,
      light,
      min: AA_TEXT,
      note: "text.primary on this fill",
      status: statusFor(light, dark, AA_TEXT),
      suggestion: nearestToken(value, themes.light, ["surface"]),
    };
  }

  const isText = TEXT_PROP.test(prop) || prop === "";
  const min = isText ? AA_TEXT : AA_LARGE_OR_UI;
  const worst = (mode: Mode): number | undefined => {
    const ratios = [themes[mode].surface.base, themes[mode].surface.baseAlternate]
      .map((background) => ratioIn(mode, value, background))
      .filter((ratio): ratio is number => ratio !== undefined);
    return ratios.length ? Math.min(...ratios) : undefined;
  };
  const light = worst("light");
  const dark = worst("dark");
  return {
    dark,
    label,
    light,
    min,
    note: `${isText ? "text" : UI_PROPS.test(prop) ? "UI (1.4.11)" : "UI"} on surface.base/baseAlternate${prop === "" ? ", role guessed" : ""}`,
    status: statusFor(light, dark, min),
    suggestion: nearestToken(value, themes.light, isText ? ["text"] : ["border", "surface"]),
  };
};

const parseArgs = (argv: string[]): {findings?: string; json?: string; overrides?: string} => {
  const args: {findings?: string; json?: string; overrides?: string} = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].replace(/^--/, "") as keyof typeof args;
    args[key] = argv[++index];
  }
  return args;
};

const printTable = (title: string, rows: AuditRow[]): void => {
  console.info(`\n## ${title}\n`);
  console.info("| Check | Light | Dark | Min | Status | Suggested token | Note |");
  console.info("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.info(
      `| ${row.label} | ${formatRatio(row.light)} | ${formatRatio(row.dark)} | ${row.min}:1 | ${row.status} | ${row.suggestion ?? ""} | ${row.note ?? ""} |`
    );
  }
};

const main = async (): Promise<void> => {
  const args = parseArgs(Bun.argv.slice(2));
  const overrides: Overrides = args.overrides ? await Bun.file(args.overrides).json() : {};
  const terreno = await loadTerrenoTheme();
  const primitives = {...terreno.primitives, ...overrides.primitives};
  const themes: Record<Mode, ResolvedTheme> = {
    dark: resolveTheme(mergeSections(mergeSections(terreno.dark, overrides.theme), overrides.dark), primitives),
    light: resolveTheme(mergeSections(mergeSections(terreno.light, overrides.theme), overrides.light), primitives),
  };

  const pairRows: AuditRow[] = SEMANTIC_PAIRS.map((pair) => {
    const ratio = (mode: Mode): number | undefined => {
      const foreground = lookup(themes[mode], pair.foreground);
      const background = lookup(themes[mode], pair.background);
      if (!foreground || !background) {
        return undefined;
      }
      return contrastRatio({background, base: themes[mode].surface.base, foreground});
    };
    const light = ratio("light");
    const dark = ratio("dark");
    return {
      dark,
      label: `${pair.foreground} on ${pair.background}`,
      light,
      min: pair.min,
      note: pair.note,
      status: statusFor(light, dark, pair.min),
    };
  });
  printTable("Semantic token pairs", pairRows);

  let findingRows: AuditRow[] = [];
  if (args.findings) {
    const findings = (await Bun.file(args.findings).json()) as ColorFinding[];
    findingRows = findings
      .map((finding) => auditFinding({finding, primitives, themes}))
      .filter((row): row is AuditRow => row !== undefined);
    printTable("Fixed colors and primitive reads", findingRows);
  }

  const failures = [...pairRows, ...findingRows].filter((row) => row.status.startsWith("FAIL"));
  console.info(
    `\nlight surface.base ${themes.light.surface.base}, dark surface.base ${themes.dark.surface.base}. ${failures.length} failing check(s).`
  );
  if (args.json) {
    await Bun.write(
      args.json,
      `${JSON.stringify({findings: findingRows, pairs: pairRows, themes}, null, 2)}\n`
    );
    console.info(`JSON: ${args.json}`);
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
};

if (import.meta.main) {
  await main();
}
